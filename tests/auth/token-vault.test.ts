import { describe, expect, it } from "vitest";
import { createTokenVault, generateMasterKey } from "../../src/auth/token-vault.js";

describe("createTokenVault", () => {
  it("round-trips a string through encrypt + decrypt", () => {
    const key = generateMasterKey();
    const vault = createTokenVault(key);
    const blob = vault.encrypt("ya29.access-token-here");
    expect(vault.decrypt(blob)).toBe("ya29.access-token-here");
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const vault = createTokenVault(generateMasterKey());
    const a = vault.encrypt("same-plaintext");
    const b = vault.encrypt("same-plaintext");
    expect(Buffer.compare(a, b)).not.toBe(0);
    expect(vault.decrypt(a)).toBe("same-plaintext");
    expect(vault.decrypt(b)).toBe("same-plaintext");
  });

  it("rejects tampered ciphertext (AEAD tag fails)", () => {
    const vault = createTokenVault(generateMasterKey());
    const blob = vault.encrypt("secret");
    // Flip a bit in the ciphertext (skip the 12-byte IV at the start).
    const tampered = Buffer.from(blob);
    if (tampered[14] !== undefined) tampered[14] = tampered[14] ^ 1;
    expect(() => vault.decrypt(tampered)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    const tooShort = Buffer.alloc(16).toString("base64");
    expect(() => createTokenVault(tooShort)).toThrow(/must be 32 bytes/);
  });

  it("rejects an empty key", () => {
    expect(() => createTokenVault("")).toThrow(/master key is empty/);
  });

  it("rejects ciphertext that is too short to be valid", () => {
    const vault = createTokenVault(generateMasterKey());
    expect(() => vault.decrypt(Buffer.from([1, 2, 3]))).toThrow(/too short/);
  });

  it("generateMasterKey produces 32 bytes encoded as base64", () => {
    const k = generateMasterKey();
    expect(Buffer.from(k, "base64").length).toBe(32);
  });
});
