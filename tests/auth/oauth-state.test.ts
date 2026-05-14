import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthStateSigner } from "../../src/auth/oauth-state.js";
import { generateMasterKey } from "../../src/auth/token-vault.js";

const KEY = generateMasterKey();

describe("createOAuthStateSigner", () => {
  it("round-trips a sid through sign + verify", () => {
    const signer = createOAuthStateSigner(KEY);
    const { token } = signer.sign("session-abc:user-xyz");
    const payload = signer.verify(token);
    expect(payload.sid).toBe("session-abc:user-xyz");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.nonce.length).toBeGreaterThan(0);
  });

  it("each sign() yields a distinct nonce", () => {
    const signer = createOAuthStateSigner(KEY);
    const a = signer.sign("sid");
    const b = signer.sign("sid");
    expect(a.token).not.toBe(b.token);
  });

  it("rejects a token with a tampered signature", () => {
    const signer = createOAuthStateSigner(KEY);
    const { token } = signer.sign("sid");
    const tampered = token.slice(0, -2) + "AA";
    expect(() => signer.verify(tampered)).toThrow(/signature mismatch/);
  });

  it("rejects a token with a tampered payload", () => {
    const signer = createOAuthStateSigner(KEY);
    const { token } = signer.sign("sid");
    const parts = token.split(".");
    const tampered = `XXXX${parts[0]?.slice(4)}.${parts[1]}`;
    expect(() => signer.verify(tampered)).toThrow();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    const signer = createOAuthStateSigner(KEY);
    const { token } = signer.sign("sid", { ttlSeconds: 60 });
    vi.advanceTimersByTime(61 * 1000);
    expect(() => signer.verify(token)).toThrow(/expired/);
    vi.useRealTimers();
  });

  it("rejects a malformed token (no dot separator)", () => {
    const signer = createOAuthStateSigner(KEY);
    expect(() => signer.verify("not-a-valid-token")).toThrow(/malformed/);
  });

  it("rejects an empty key", () => {
    expect(() => createOAuthStateSigner("")).toThrow(/master key is empty/);
  });

  it("verifies are bound to the key (different key fails)", () => {
    const signerA = createOAuthStateSigner(generateMasterKey());
    const signerB = createOAuthStateSigner(generateMasterKey());
    const { token } = signerA.sign("sid");
    expect(() => signerB.verify(token)).toThrow();
  });
});
