// Makes a VAPID key pair for web push (RFC 8292), printed as lines for .env:
//   node deploy/vapid-keys.mjs >> .env
// The private key stays on the server. A new pair makes every browser subscribe again.
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const privateKey = (await subtle.exportKey('jwk', pair.privateKey)).d;
console.log(`PULSE_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`PULSE_VAPID_PRIVATE_KEY=${privateKey}`);
