import { encryptCurrent, decryptAuto, migrateToCurrent } from "./registry/cipherRegistry.js";

// Keep the same public API shape the rest of Trilium expects
export async function encrypt(key: Buffer, plainText: Buffer | string) {
  return encryptCurrent(key, plainText);
}

export async function decrypt(key: Buffer, cipherText: string | Buffer) {
  // normalize to string
  const cipherString = Buffer.isBuffer(cipherText)
    ? cipherText.toString()
    : cipherText;

  return decryptAuto(key, cipherString);
}

export async function decryptString(key: Buffer, cipherText: string) {
  const buf = await decryptAuto(key, cipherText);
  return buf ? buf.toString("utf8") : null;
}

// optional: expose migrate function if higher layers want it
export { migrateToCurrent };

export default { encrypt, decrypt, decryptString };
