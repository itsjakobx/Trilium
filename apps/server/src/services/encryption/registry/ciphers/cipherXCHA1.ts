import sodium from "libsodium-wrappers";
import { CipherImplementation, registerCipher } from "./cipherRegistry.js";

const VERSION = Buffer.from("XCH1");

async function normalizeKey(key: Buffer) {
  await sodium.ready;
  if (key.length === sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) return key;
  return sodium.crypto_generichash(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES, key);
}

const impl: CipherImplementation = {
  version: "XCH1",

  async encrypt(key, plaintext) {
    await sodium.ready;
    const k = await normalizeKey(key);
    const msg = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(msg, null, null, nonce, k);
    return Buffer.concat([VERSION, Buffer.from(nonce), Buffer.from(ct)]).toString("base64");
  },

  async decrypt(key, ciphertext) {
    await sodium.ready;
    try {
      const buf = Buffer.from(ciphertext.toString(), "base64");
      const nonceLen = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
      const nonce = buf.subarray(4, 4 + nonceLen);
      const ct = buf.subarray(4 + nonceLen);
      const k = await normalizeKey(key);
      const pt = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, null, nonce, k);
      return Buffer.from(pt);
    } catch {
      return false;
    }
  },
};

registerCipher(impl);

