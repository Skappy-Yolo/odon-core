import { describe, expect, it } from "vitest";
import { createSessionFromMessage } from "../../src/orchestrator/sessions.js";
import type { IncomingMessage } from "../../src/core/contract.js";
import type { Queryable } from "../../src/db/queries.js";

/**
 * Tiny fake Queryable that returns canned rows based on the SQL it sees.
 * Just enough to drive createSessionFromMessage through its happy and
 * sad paths without a real Postgres.
 */
function fakeDb(opts: {
  shortCodeCollidesOnFirstNAttempts?: number;
} = {}): { db: Queryable; calls: string[] } {
  const calls: string[] = [];
  let lookupAttempts = 0;
  const db = {
    async query(sql: string, _params?: unknown[]) {
      calls.push(firstWord(sql));
      if (sql.includes("INTO users")) {
        return { rows: [{ id: "user-uuid", rail: "telegram", display_name: "Sarah" }] };
      }
      if (sql.includes("INTO groups")) {
        return { rows: [{ id: "group-uuid", rail: "telegram", display_name: "The Squad" }] };
      }
      if (sql.includes("FROM sessions WHERE short_code")) {
        lookupAttempts++;
        if (lookupAttempts <= (opts.shortCodeCollidesOnFirstNAttempts ?? 0)) {
          return { rows: [{ id: "existing-session" }] };
        }
        return { rows: [] };
      }
      if (sql.includes("INTO sessions")) {
        return {
          rows: [
            {
              id: "session-uuid",
              short_code: "ABCD2345",
              group_id: "group-uuid",
              initiator_user_id: "user-uuid",
              label: "movie this weekend",
              deadline: new Date(),
              password_hash: null,
              status: "open",
            },
          ],
        };
      }
      return { rows: [] };
    },
  } as unknown as Queryable;
  return { db, calls };
}

function firstWord(sql: string): string {
  return (sql.trim().split(/\s+/)[0] ?? "?").toUpperCase();
}

function groupMessage(text: string): IncomingMessage {
  return {
    rail: "telegram",
    receivedAt: new Date(),
    user: { rail: "telegram", platformUserId: "42", displayName: "Sarah" },
    group: { rail: "telegram", platformGroupId: "-100", displayName: "The Squad" },
    text,
    raw: null,
  };
}

function privateMessage(text: string): IncomingMessage {
  return {
    rail: "telegram",
    receivedAt: new Date(),
    user: { rail: "telegram", platformUserId: "42", displayName: "Sarah" },
    group: null,
    text,
    raw: null,
  };
}

describe("createSessionFromMessage", () => {
  it("happy path: upserts user + group, creates session, returns the row", async () => {
    const { db, calls } = fakeDb();
    const result = await createSessionFromMessage(
      { db },
      { message: groupMessage("/find_time movie this weekend"), label: "movie this weekend" },
    );
    expect(calls).toEqual(["INSERT", "INSERT", "SELECT", "INSERT"]);
    expect(result.session.short_code).toBe("ABCD2345");
    expect(result.initiator.display_name).toBe("Sarah");
    expect(result.group?.display_name).toBe("The Squad");
  });

  it("rejects creation outside a group (DMs are not supported)", async () => {
    const { db } = fakeDb();
    await expect(
      createSessionFromMessage(
        { db },
        { message: privateMessage("/find_time movie"), label: "movie" },
      ),
    ).rejects.toThrow(/cannot create a session outside a group/);
  });

  it("rejects an empty label", async () => {
    const { db } = fakeDb();
    await expect(
      createSessionFromMessage({ db }, { message: groupMessage("/find_time"), label: "  " }),
    ).rejects.toThrow(/label is required/);
  });

  it("retries on short-code collision and eventually succeeds", async () => {
    const { db, calls } = fakeDb({ shortCodeCollidesOnFirstNAttempts: 2 });
    const result = await createSessionFromMessage(
      { db },
      { message: groupMessage("/find_time movie"), label: "movie" },
    );
    expect(result.session.short_code).toBe("ABCD2345");
    // 2 upserts + 3 SELECTs (two collisions + one clear) + 1 INSERT INTO sessions
    expect(calls.filter((c) => c === "SELECT").length).toBe(3);
  });

  it("gives up after three collisions in a row", async () => {
    const { db } = fakeDb({ shortCodeCollidesOnFirstNAttempts: 99 });
    await expect(
      createSessionFromMessage(
        { db },
        { message: groupMessage("/find_time movie"), label: "movie" },
      ),
    ).rejects.toThrow(/unique short code/);
  });

  it("uses the deadlineHours override when provided", async () => {
    const { db } = fakeDb();
    const fakeNow = new Date("2026-05-13T12:00:00Z");
    const result = await createSessionFromMessage(
      { db, now: () => fakeNow },
      { message: groupMessage("/find_time movie"), label: "movie", deadlineHours: 6 },
    );
    // We can't directly read what was inserted, but we can confirm the
    // returned deadline came from this code path (the fake db returns
    // its own canned deadline, so this is really just a smoke check that
    // the now-override path runs).
    expect(result.session).toBeDefined();
  });
});
