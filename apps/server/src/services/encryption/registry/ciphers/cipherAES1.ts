import crypto from "crypto";
import { CipherImplementation, registerCipher } from "./cipherRegistry.js";

function pad16(buf: Buffer) {
  if (buf.length > 16) return buf.slice(0, 16);
  if (buf.length < 16) return Buffer.concat([buf, Buffer.alloc(16 - buf.length)]);
  return buf;
}

async function encrypt(key: Buffer, plaintext: Buffer | string) {
  const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-cbc", pad16(key), iv);
  const digest = crypto.createHash("sha1").update(pt).digest().slice(0, 4);
  const data = Buffer.concat([digest, pt]);
  const ct = Buffer.concat([iv, cipher.update(data), cipher.final()]);
  return ct.toString("base64");
}

async function decrypt(key: Buffer, ciphertext: string | Buffer) {
  try {
    const buf = Buffer.from(ciphertext.toString(), "base64");
    const ivLength = buf.length % 16 === 0 ? 16 : 13;
    const iv = buf.subarray(0, ivLength);
    const ct = buf.subarray(ivLength);
    const decipher = crypto.createDecipheriv("aes-128-cbc", pad16(key), pad16(iv));
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.slice(4); // strip digest
  } catch {
    return false;
  }
}

registerCipher({ version: "AES1", encrypt, decrypt });
