import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate } from "../../../src/adapters/telegram/normalize.js";
import type { TelegramUpdate } from "../../../src/adapters/telegram/types.js";

const baseUser = { id: 42, is_bot: false, first_name: "Sarah" };

function update(message: object | undefined): TelegramUpdate {
  return { update_id: 1, message: message as TelegramUpdate["message"] };
}

describe("normalizeTelegramUpdate", () => {
  it("normalizes a text message in a group", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 100,
        date: 1_750_000_000,
        text: "/find_time movie this weekend",
        from: baseUser,
        chat: { id: -1001234567890, type: "supergroup", title: "The Squad" },
      }),
    );
    expect(out).not.toBeNull();
    if (out) {
      expect(out.rail).toBe("telegram");
      expect(out.user.platformUserId).toBe("42");
      expect(out.user.displayName).toBe("Sarah");
      expect(out.group?.platformGroupId).toBe("-1001234567890");
      expect(out.group?.displayName).toBe("The Squad");
      expect(out.text).toBe("/find_time movie this weekend");
      expect(out.receivedAt).toBeInstanceOf(Date);
    }
  });

  it("normalizes a text message in a private chat (group is null)", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 100,
        date: 1_750_000_000,
        text: "hi",
        from: baseUser,
        chat: { id: 42, type: "private", first_name: "Sarah" },
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.group).toBeNull();
  });

  it("composes display name from first + last when both are present", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 1,
        date: 1_750_000_000,
        text: "hi",
        from: { id: 1, is_bot: false, first_name: "Sarah", last_name: "Doe" },
        chat: { id: 1, type: "private" },
      }),
    );
    expect(out?.user.displayName).toBe("Sarah Doe");
  });

  it("returns null for updates without a message", () => {
    expect(normalizeTelegramUpdate({ update_id: 1 } as TelegramUpdate)).toBeNull();
  });

  it("returns null for messages without text (e.g. stickers, photos)", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 1,
        date: 1_750_000_000,
        from: baseUser,
        chat: { id: 1, type: "private" },
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null for messages from bots (defence against bot loops)", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 1,
        date: 1_750_000_000,
        text: "hi",
        from: { id: 99, is_bot: true, first_name: "OtherBot" },
        chat: { id: 1, type: "group", title: "g" },
      }),
    );
    expect(out).toBeNull();
  });

  it("returns null when from is missing (channel posts etc.)", () => {
    const out = normalizeTelegramUpdate(
      update({
        message_id: 1,
        date: 1_750_000_000,
        text: "hi",
        chat: { id: 1, type: "channel", title: "ch" },
      }),
    );
    expect(out).toBeNull();
  });

  it("preserves the raw update so adapters can look back at fields normalize didn't capture", () => {
    const raw = update({
      message_id: 1,
      date: 1_750_000_000,
      text: "hi",
      from: baseUser,
      chat: { id: 1, type: "private" },
    });
    const out = normalizeTelegramUpdate(raw);
    expect(out?.raw).toBe(raw);
  });
});
