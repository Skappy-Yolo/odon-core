/**
 * Envelope encryption for OAuth tokens at rest.
 *
 * AES-256-GCM with a per-row random 96-bit IV. The IV travels with the
 * ciphertext (output is `iv || ciphertext || tag`), so we don't have to
 * store it separately on the row.
 *
 * The master key (TOKEN_ENCRYPTION_KEY) is base64-encoded 32 bytes. In
 * production it should be KMS-wrapped; for now we read it straight from
 * env. Key rotation is a future commit and will require either
 * versioned ciphertext (first byte = key version) or a separate
 * `key_id` column on calendar_tokens. Either works; not solving it now.
 *
 * Hard rule: the master key never leaves this module's closure. Callers
 * get encrypt() / decrypt() functions, never the key itself.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface TokenVault {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

/**
 * Build a TokenVault from a base64-encoded master key. Throws if the key
 * is missing or the wrong length. Callers should construct one of these
 * at startup and pass it down; do not construct per-request.
 */
export function createTokenVault(masterKeyB64: string): TokenVault {
  if (!masterKeyB64) {
    throw new Error("createTokenVault: master key is empty");
  }
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `createTokenVault: master key must be ${KEY_BYTES} bytes (got ${key.length}); generate with \`openssl rand -base64 32\``,
    );
  }

  return {
    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, ciphertext, tag]);
    },
    decrypt(blob: Buffer): string {
      if (blob.length < IV_BYTES + TAG_BYTES) {
        throw new Error("TokenVault.decrypt: ciphertext too short");
      }
      const iv = blob.subarray(0, IV_BYTES);
      const tag = blob.subarray(blob.length - TAG_BYTES);
      const ciphertext = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    },
  };
}

/**
 * Generate a 256-bit key, base64-encoded. Useful one-shot for setup.
 * Print the result of this once, paste it into env, never log it again.
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
