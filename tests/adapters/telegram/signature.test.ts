import { describe, expect, it } from "vitest";
import { verifyTelegramSignature } from "../../../src/adapters/telegram/signature.js";

const SECRET = "super-secret-token-only-the-bot-and-telegram-know";

describe("verifyTelegramSignature", () => {
  it("accepts requests carrying the exact expected secret token", () => {
    const ok = verifyTelegramSignature(
      { "x-telegram-bot-api-secret-token": SECRET },
      { expectedSecretToken: SECRET },
    );
    expect(ok).toBe(true);
  });

  it("rejects when the secret token is wrong", () => {
    const ok = verifyTelegramSignature(
      { "x-telegram-bot-api-secret-token": "wrong" },
      { expectedSecretToken: SECRET },
    );
    expect(ok).toBe(false);
  });

  it("rejects when the secret token header is missing", () => {
    const ok = verifyTelegramSignature(
      { "user-agent": "telegram" },
      { expectedSecretToken: SECRET },
    );
    expect(ok).toBe(false);
  });

  it("rejects when the expected secret is empty", () => {
    const ok = verifyTelegramSignature(
      { "x-telegram-bot-api-secret-token": SECRET },
      { expectedSecretToken: "" },
    );
    expect(ok).toBe(false);
  });

  it("is case-insensitive on the header name", () => {
    const ok = verifyTelegramSignature(
      { "X-Telegram-Bot-Api-Secret-Token": SECRET },
      { expectedSecretToken: SECRET },
    );
    expect(ok).toBe(true);
  });

  it("rejects when secrets are of different lengths even with a common prefix", () => {
    const ok = verifyTelegramSignature(
      { "x-telegram-bot-api-secret-token": SECRET + "extra" },
      { expectedSecretToken: SECRET },
    );
    expect(ok).toBe(false);
  });
});
