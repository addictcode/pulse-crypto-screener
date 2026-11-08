package dev.pulse.push;

import static dev.pulse.push.WebPushCrypto.b64;
import static dev.pulse.push.WebPushCrypto.unb64;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.Signature;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.junit.jupiter.api.Test;

class WebPushCryptoTest {

    // RFC 8291, appendix A: the worked example of an encrypted push message. The expected body was
    // also produced byte for byte by the reference implementation http_ece (Python), since the RFC
    // text itself cannot be fetched from the cloud where this was written.
    private static final String PLAINTEXT = "When I grow up, I want to be a watermelon";
    private static final String AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private static final String AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private static final String UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private static final String UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    private static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
    private static final String SALT = "DGv6ra1nlYgDCS1FRnbzlw";
    private static final String BODY = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    @Test
    void theExampleOfRfc8291ComesOutByteForByte() throws Exception {
        KeyPair sender = WebPushCrypto.keyPair(unb64(AS_PUBLIC), unb64(AS_PRIVATE));
        byte[] body = WebPushCrypto.encrypt(PLAINTEXT.getBytes(StandardCharsets.UTF_8), unb64(UA_PUBLIC), unb64(AUTH), sender, unb64(SALT));

        assertThat(b64(body)).isEqualTo(BODY);
    }

    @Test
    void theBrowserCanReadAMessageWithAFreshKey() throws Exception {
        byte[] body = WebPushCrypto.encrypt("{\"title\":\"BTC jumps\"}".getBytes(StandardCharsets.UTF_8), unb64(UA_PUBLIC), unb64(AUTH));

        assertThat(new String(decrypt(body, unb64(UA_PUBLIC), unb64(UA_PRIVATE), unb64(AUTH)), StandardCharsets.UTF_8)).isEqualTo("{\"title\":\"BTC jumps\"}");
    }

    @Test
    void theVapidHeaderIsAnEs256TokenThePublicKeyVerifies() throws Exception {
        byte[][] keys = WebPushCrypto.newVapidKeys();
        String header = WebPushCrypto.vapidHeader("https://fcm.googleapis.com", "mailto:owner@example.com", 1_800_000_000L, keys[0], keys[1]);

        assertThat(header).startsWith("vapid t=").contains(", k=" + b64(keys[0]));
        String jwt = header.substring("vapid t=".length(), header.indexOf(','));
        String[] parts = jwt.split("\\.");
        assertThat(new String(unb64(parts[1]), StandardCharsets.UTF_8))
                .isEqualTo("{\"aud\":\"https://fcm.googleapis.com\",\"exp\":1800043200,\"sub\":\"mailto:owner@example.com\"}");
        byte[] raw = unb64(parts[2]);
        assertThat(raw).hasSize(64);
        Signature es256 = Signature.getInstance("SHA256withECDSAinP1363Format");
        es256.initVerify(WebPushCrypto.publicKey(keys[0]));
        es256.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(es256.verify(raw)).isTrue();
    }

    /** What the browser does with a push body: RFC 8291 from the receiving side. */
    static byte[] decrypt(byte[] body, byte[] uaPublic, byte[] uaPrivate, byte[] auth) throws Exception {
        ByteBuffer in = ByteBuffer.wrap(body);
        byte[] salt = new byte[16];
        in.get(salt);
        in.getInt();
        byte[] asPublic = new byte[in.get()];
        in.get(asPublic);
        byte[] record = Arrays.copyOfRange(body, in.position(), body.length);
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(WebPushCrypto.privateKey(uaPrivate));
        agreement.doPhase(WebPushCrypto.publicKey(asPublic), true);
        byte[] prkKey = WebPushCrypto.hmac(auth, agreement.generateSecret());
        byte[] ikm = WebPushCrypto.hmac(prkKey, WebPushCrypto.concat("WebPush: info".getBytes(StandardCharsets.US_ASCII), new byte[] {0}, uaPublic, asPublic, new byte[] {1}));
        byte[] prk = WebPushCrypto.hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(WebPushCrypto.hmac(prk, WebPushCrypto.concat("Content-Encoding: aes128gcm".getBytes(StandardCharsets.US_ASCII), new byte[] {0, 1})), 16);
        byte[] nonce = Arrays.copyOf(WebPushCrypto.hmac(prk, WebPushCrypto.concat("Content-Encoding: nonce".getBytes(StandardCharsets.US_ASCII), new byte[] {0, 1})), 12);
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] padded = gcm.doFinal(record);
        int end = padded.length - 1;
        while (padded[end] == 0) {
            end--;
        }
        return Arrays.copyOf(padded, end);
    }
}
