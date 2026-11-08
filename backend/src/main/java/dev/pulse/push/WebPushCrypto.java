package dev.pulse.push;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Web Push message encryption (RFC 8291, the aes128gcm content coding of RFC 8188) and the
 * VAPID signature (RFC 8292), on the JDK's own crypto: P-256 key agreement, HKDF over HMAC-SHA-256,
 * AES-128-GCM and ES256. A library would bring a provider and a dozen classes for these fifty lines;
 * the test checks the result against the worked example of RFC 8291 byte for byte.
 */
public final class WebPushCrypto {

    /** One record holds the whole message: pushes are small, the browser's limit is 4096. */
    static final int RECORD_SIZE = 4096;
    private static final ECParameterSpec P256 = p256();
    private static final SecureRandom RANDOM = new SecureRandom();

    private WebPushCrypto() {
    }

    /** The body of a push message for a subscription, with a fresh sender key and salt. */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret) {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(P256);
            byte[] salt = new byte[16];
            RANDOM.nextBytes(salt);
            return encrypt(plaintext, uaPublic, authSecret, generator.generateKeyPair(), salt);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** RFC 8291 section 3 with the sender's key pair and salt given, so the example can be replayed. */
    static byte[] encrypt(byte[] plaintext, byte[] uaPublic, byte[] authSecret, KeyPair sender, byte[] salt) throws GeneralSecurityException {
        if (plaintext.length + 17 > RECORD_SIZE - 86) {
            throw new IllegalArgumentException("push message too long: " + plaintext.length + " bytes");
        }
        byte[] asPublic = encodePoint((ECPublicKey) sender.getPublic());
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(sender.getPrivate());
        agreement.doPhase(publicKey(uaPublic), true);
        byte[] ecdhSecret = agreement.generateSecret();

        byte[] prkKey = hmac(authSecret, ecdhSecret);
        byte[] keyInfo = concat("WebPush: info".getBytes(StandardCharsets.US_ASCII), new byte[] {0}, uaPublic, asPublic);
        byte[] ikm = hmac(prkKey, concat(keyInfo, new byte[] {1}));
        byte[] prk = hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(hmac(prk, concat("Content-Encoding: aes128gcm".getBytes(StandardCharsets.US_ASCII), new byte[] {0, 1})), 16);
        byte[] nonce = Arrays.copyOf(hmac(prk, concat("Content-Encoding: nonce".getBytes(StandardCharsets.US_ASCII), new byte[] {0, 1})), 12);

        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        // the last (and only) record ends with the delimiter 2, no padding
        byte[] record = gcm.doFinal(concat(plaintext, new byte[] {2}));

        ByteBuffer header = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length);
        header.put(salt).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic);
        return concat(header.array(), record);
    }

    /**
     * The VAPID header of RFC 8292: a JWT signed with the server's key, saying who sends to which
     * push service, valid for 12 hours. Push services reject unsigned or expired requests.
     */
    public static String vapidHeader(String audience, String subject, long nowSeconds, byte[] publicKey, byte[] privateKey) {
        try {
            String header = b64("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
            String claims = b64(("{\"aud\":\"" + audience + "\",\"exp\":" + (nowSeconds + 12 * 3600) + ",\"sub\":\"" + subject + "\"}")
                    .getBytes(StandardCharsets.UTF_8));
            Signature es256 = Signature.getInstance("SHA256withECDSA");
            es256.initSign(privateKey(privateKey));
            es256.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
            String jwt = header + "." + claims + "." + b64(derToRaw(es256.sign()));
            return "vapid t=" + jwt + ", k=" + b64(publicKey);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** A new VAPID key pair as [public 65 bytes, private 32 bytes], for deploy/vapid-keys. */
    public static byte[][] newVapidKeys() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(P256);
            KeyPair pair = generator.generateKeyPair();
            return new byte[][] {encodePoint((ECPublicKey) pair.getPublic()), unsigned(((ECPrivateKey) pair.getPrivate()).getS())};
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------- keys and encodings ----------

    static ECPublicKey publicKey(byte[] uncompressed) throws GeneralSecurityException {
        if (uncompressed.length != 65 || uncompressed[0] != 4) {
            throw new GeneralSecurityException("not an uncompressed P-256 point");
        }
        ECPoint point = new ECPoint(new BigInteger(1, Arrays.copyOfRange(uncompressed, 1, 33)), new BigInteger(1, Arrays.copyOfRange(uncompressed, 33, 65)));
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(point, P256));
    }

    static ECPrivateKey privateKey(byte[] raw) throws GeneralSecurityException {
        return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1, raw), P256));
    }

    static KeyPair keyPair(byte[] publicRaw, byte[] privateRaw) throws GeneralSecurityException {
        return new KeyPair(publicKey(publicRaw), privateKey(privateRaw));
    }

    static byte[] encodePoint(ECPublicKey key) {
        return concat(new byte[] {4}, unsigned(key.getW().getAffineX()), unsigned(key.getW().getAffineY()));
    }

    /** A coordinate as exactly 32 bytes, big-endian. */
    private static byte[] unsigned(BigInteger v) {
        byte[] bytes = v.toByteArray();
        byte[] out = new byte[32];
        int from = Math.max(0, bytes.length - 32);
        System.arraycopy(bytes, from, out, 32 - (bytes.length - from), bytes.length - from);
        return out;
    }

    /** The JDK signs ECDSA as DER; JWT wants r and s side by side, 32 bytes each. */
    static byte[] derToRaw(byte[] der) {
        int offset = der[1] < 0 ? 3 : 2;
        int rLength = der[offset + 1];
        BigInteger r = new BigInteger(1, Arrays.copyOfRange(der, offset + 2, offset + 2 + rLength));
        int sAt = offset + 2 + rLength;
        int sLength = der[sAt + 1];
        BigInteger s = new BigInteger(1, Arrays.copyOfRange(der, sAt + 2, sAt + 2 + sLength));
        return concat(unsigned(r), unsigned(s));
    }

    static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    static byte[] concat(byte[]... parts) {
        int length = 0;
        for (byte[] p : parts) {
            length += p.length;
        }
        byte[] out = new byte[length];
        int at = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, at, p.length);
            at += p.length;
        }
        return out;
    }

    public static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static byte[] unb64(String text) {
        return Base64.getUrlDecoder().decode(text.trim().replace('+', '-').replace('/', '_').replace("=", ""));
    }

    private static ECParameterSpec p256() {
        try {
            AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
            parameters.init(new ECGenParameterSpec("secp256r1"));
            return parameters.getParameterSpec(ECParameterSpec.class);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
