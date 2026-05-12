import { describe, expect, it, vi } from "vitest";
import { TelegramAdapter } from "../../../src/adapters/telegram/adapter.js";
import { TelegramApiClient } from "../../../src/adapters/telegram/client.js";
import type { OutgoingMessage } from "../../../src/core/contract.js";

const SECRET = "test-secret";
const BOT_TOKEN = "test-bot-token";

describe("TelegramAdapter", () => {
  it("verifyWebhookSignature delegates to the secret-token check", () => {
    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
    });
    expect(
      adapter.verifyWebhookSignature(
        { "x-telegram-bot-api-secret-token": SECRET },
        "{}",
      ),
    ).toBe(true);
    expect(
      adapter.verifyWebhookSignature(
        { "x-telegram-bot-api-secret-token": "wrong" },
        "{}",
      ),
    ).toBe(false);
  });

  it("normalize returns null when the payload is not a Telegram update", () => {
    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
    });
    expect(adapter.normalize({})).toBeNull();
    expect(adapter.normalize(null)).toBeNull();
    expect(adapter.normalize("hi")).toBeNull();
  });

  it("normalize returns an IncomingMessage for a text update", () => {
    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
    });
    const out = adapter.normalize({
      update_id: 1,
      message: {
        message_id: 100,
        date: 1_750_000_000,
        text: "/start",
        from: { id: 7, is_bot: false, first_name: "Mike" },
        chat: { id: 7, type: "private", first_name: "Mike" },
      },
    });
    expect(out?.text).toBe("/start");
    expect(out?.user.platformUserId).toBe("7");
  });

  it("send calls Telegram's sendMessage with the right chat_id for a user target", async () => {
    const fakeSend = vi.fn().mockResolvedValue(undefined);
    const client = { sendMessage: fakeSend } as unknown as TelegramApiClient;

    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
      client,
    });

    const outgoing: OutgoingMessage = {
      target: { kind: "user", rail: "telegram", platformUserId: "12345" },
      text: "hi",
    };
    await adapter.send(outgoing);

    expect(fakeSend).toHaveBeenCalledTimes(1);
    const arg = fakeSend.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ chat_id: 12345, text: "hi" });
    expect(arg.reply_markup).toBeUndefined();
  });

  it("send builds an inline_keyboard when buttons are supplied", async () => {
    const fakeSend = vi.fn().mockResolvedValue(undefined);
    const client = { sendMessage: fakeSend } as unknown as TelegramApiClient;

    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
      client,
    });

    await adapter.send({
      target: { kind: "group", rail: "telegram", platformGroupId: "-100123" },
      text: "vote",
      buttons: [
        { label: "Wait", value: "wait" },
        { label: "Proceed", value: "proceed" },
      ],
    });

    const arg = fakeSend.mock.calls[0]?.[0];
    expect(arg.chat_id).toBe(-100123);
    expect(arg.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "Wait", callback_data: "wait" },
          { text: "Proceed", callback_data: "proceed" },
        ],
      ],
    });
  });

  it("send throws when the target rail is not telegram", async () => {
    const fakeSend = vi.fn();
    const client = { sendMessage: fakeSend } as unknown as TelegramApiClient;

    const adapter = new TelegramAdapter({
      botToken: BOT_TOKEN,
      webhookSecretToken: SECRET,
      client,
    });

    await expect(
      adapter.send({
        target: { kind: "user", rail: "discord", platformUserId: "12345" },
        text: "hi",
      }),
    ).rejects.toThrow(/rail mismatch/);
    expect(fakeSend).not.toHaveBeenCalled();
  });
});
