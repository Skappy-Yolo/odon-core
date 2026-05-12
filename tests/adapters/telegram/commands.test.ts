import { describe, expect, it } from "vitest";
import { parseCommand, routeCommand } from "../../../src/adapters/telegram/commands.js";
import type { IncomingMessage } from "../../../src/core/contract.js";

function message(overrides: Partial<IncomingMessage> & { text: string }): IncomingMessage {
  return {
    rail: "telegram",
    receivedAt: new Date(0),
    user: {
      rail: "telegram",
      platformUserId: "42",
      displayName: "Sarah",
    },
    group: {
      rail: "telegram",
      platformGroupId: "-100",
      displayName: "The Squad",
    },
    text: overrides.text,
    raw: null,
    ...overrides,
  };
}

describe("parseCommand", () => {
  it("parses bare slash commands", () => {
    expect(parseCommand("/start")).toEqual({ name: "start", rest: "" });
    expect(parseCommand("/help")).toEqual({ name: "help", rest: "" });
  });

  it("parses commands with arguments", () => {
    expect(parseCommand("/find_time movie this weekend")).toEqual({
      name: "find_time",
      rest: "movie this weekend",
    });
    expect(parseCommand("/where Lekki")).toEqual({ name: "where", rest: "Lekki" });
  });

  it("strips bot mentions like /start@OdonBot", () => {
    expect(parseCommand("/start@OdonBot")).toEqual({ name: "start", rest: "" });
    expect(parseCommand("/find_time@OdonBot movie")).toEqual({
      name: "find_time",
      rest: "movie",
    });
  });

  it("is case-insensitive on the command name", () => {
    expect(parseCommand("/START")).toEqual({ name: "start", rest: "" });
    expect(parseCommand("/Find_Time tonight")).toEqual({ name: "find_time", rest: "tonight" });
  });

  it("returns null for non-command messages", () => {
    expect(parseCommand("hi everyone")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("? /start")).toBeNull();
  });

  it("returns null for unknown commands", () => {
    expect(parseCommand("/foo")).toBeNull();
    expect(parseCommand("/start_party")).toBeNull();
  });
});

describe("routeCommand", () => {
  it("returns null for non-command text (does not reply)", () => {
    expect(routeCommand(message({ text: "hi" }))).toBeNull();
  });

  it("/start produces a welcome reply targeted at the group when in a group", () => {
    const out = routeCommand(message({ text: "/start" }));
    expect(out).not.toBeNull();
    expect(out?.target).toEqual({
      kind: "group",
      rail: "telegram",
      platformGroupId: "-100",
    });
    expect(out?.text).toContain("Odon");
    expect(out?.text).toContain("/find_time");
  });

  it("/start in a private chat targets the user", () => {
    const m = message({ text: "/start", group: null });
    const out = routeCommand(m);
    expect(out?.target).toEqual({
      kind: "user",
      rail: "telegram",
      platformUserId: "42",
    });
  });

  it("/help routes to the same content as /start", () => {
    const start = routeCommand(message({ text: "/start" }));
    const help = routeCommand(message({ text: "/help" }));
    expect(help?.text).toBe(start?.text);
  });

  it("/find_time, /where, /confirm return stub replies (acknowledge but tell the user it's not wired)", () => {
    for (const cmd of ["/find_time movie", "/where Lekki", "/confirm 1"]) {
      const out = routeCommand(message({ text: cmd }));
      expect(out).not.toBeNull();
      expect(out?.text).toMatch(/scaffolded|coming/i);
    }
  });
});
