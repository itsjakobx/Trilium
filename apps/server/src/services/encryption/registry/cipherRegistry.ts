// Unified cryptographic registry
// Every algorithm implementation lives here and registers itself by version tag.

import log from "../../log.js";

// ---------- Shared Interface ----------

export interface CipherImplementation {
    version: string; // e.g. "AES1", "XCH1"
    encrypt: (key: Buffer, plaintext: Buffer | string) => Promise<string>;
    decrypt: (key: Buffer, ciphertext: string | Buffer) => Promise<Buffer | false | null>;
}

// The actual registry mapping
const CIPHER_REGISTRY: Record<string, CipherImplementation> = {};

// Helper for registration
export function registerCipher(impl: CipherImplementation) {
    CIPHER_REGISTRY[impl.version] = impl;
    log.info(`Registered cipher ${impl.version}`);
}

export function getCipher(version: string): CipherImplementation | undefined {
    return CIPHER_REGISTRY[version];
}

// Detect version from base64 data (first 4–5 ASCII bytes)
export function detectVersion(cipherTextB64: string): string | undefined {
    try {
        const buf = Buffer.from(cipherTextB64, "base64");
        const tag = buf.subarray(0, 4).toString("ascii");
        if (CIPHER_REGISTRY[tag]) return tag;
    } catch { /* ignore */ }
    return undefined;
}

// Public entry points: encrypt/decrypt by current default
const CURRENT_VERSION = "XCH1";

export async function encryptCurrent(key: Buffer, plaintext: Buffer | string): Promise<string> {
    const impl = getCipher(CURRENT_VERSION);
    if (!impl) throw new Error(`No cipher registered for ${CURRENT_VERSION}`);
    return impl.encrypt(key, plaintext);
}

export async function decryptAuto(key: Buffer, ciphertextB64: string): Promise<Buffer | false | null> {
    const version = detectVersion(ciphertextB64) || "AES1"; // fallback legacy
    const impl = getCipher(version);
    if (!impl) throw new Error(`Unsupported cipher version: ${version}`);
    return impl.decrypt(key, ciphertextB64);
}

// Migration helper
export async function migrateToCurrent(
    key: Buffer,
    oldCiphertextB64: string,
    saveFn?: (newB64: string) => Promise<void> | void
): Promise<boolean> {
    const version = detectVersion(oldCiphertextB64);
    if (version === CURRENT_VERSION) return false;

    const impl = getCipher(version || "AES1");
    if (!impl) return false;

    const plaintext = await impl.decrypt(key, oldCiphertextB64);
    if (!plaintext) return false;

    const newCiphertext = await encryptCurrent(key, plaintext);
    if (saveFn) await Promise.resolve(saveFn(newCiphertext));

    log.info(`Migrated ${version} → ${CURRENT_VERSION}`);
    return true;
}
