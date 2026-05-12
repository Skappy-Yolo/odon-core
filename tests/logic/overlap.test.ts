import { describe, expect, it } from "vitest";
import {
  findOverlapWindows,
  intervalsOverlap,
  memberIsFree,
} from "../../src/logic/overlap.js";
import type { MemberAvailability } from "../../src/logic/types.js";

const utc = (yyyy: number, mm: number, dd: number, hh = 0, min = 0): Date =>
  new Date(Date.UTC(yyyy, mm - 1, dd, hh, min));

describe("intervalsOverlap", () => {
  it("returns true when intervals overlap", () => {
    expect(
      intervalsOverlap(
        { start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) },
        { start: utc(2026, 5, 16, 15), end: utc(2026, 5, 16, 17) },
      ),
    ).toBe(true);
  });

  it("returns false when intervals merely touch (half-open)", () => {
    expect(
      intervalsOverlap(
        { start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) },
        { start: utc(2026, 5, 16, 16), end: utc(2026, 5, 16, 18) },
      ),
    ).toBe(false);
  });

  it("returns false when intervals are clearly disjoint", () => {
    expect(
      intervalsOverlap(
        { start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) },
        { start: utc(2026, 5, 16, 17), end: utc(2026, 5, 16, 18) },
      ),
    ).toBe(false);
  });

  it("is symmetric", () => {
    const a = { start: utc(2026, 5, 16, 10), end: utc(2026, 5, 16, 12) };
    const b = { start: utc(2026, 5, 16, 11), end: utc(2026, 5, 16, 13) };
    expect(intervalsOverlap(a, b)).toBe(intervalsOverlap(b, a));
  });
});

describe("memberIsFree", () => {
  const slotStart = utc(2026, 5, 16, 19);
  const slotEnd = utc(2026, 5, 16, 21);

  it("is free when busy list is empty", () => {
    expect(memberIsFree([], slotStart, slotEnd)).toBe(true);
  });

  it("is busy when a meeting overlaps the slot", () => {
    expect(
      memberIsFree(
        [{ start: utc(2026, 5, 16, 20), end: utc(2026, 5, 16, 22) }],
        slotStart,
        slotEnd,
      ),
    ).toBe(false);
  });

  it("is free when meetings are entirely outside the slot", () => {
    expect(
      memberIsFree(
        [
          { start: utc(2026, 5, 16, 9), end: utc(2026, 5, 16, 10) },
          { start: utc(2026, 5, 16, 22), end: utc(2026, 5, 16, 23) },
        ],
        slotStart,
        slotEnd,
      ),
    ).toBe(true);
  });
});

describe("findOverlapWindows", () => {
  // Saturday May 16 2026, search window 9am to 11pm UTC.
  const searchWindow = {
    start: utc(2026, 5, 16, 9),
    end: utc(2026, 5, 16, 23),
  };

  it("returns nothing when no members provided", () => {
    expect(
      findOverlapWindows({
        members: [],
        searchWindow,
        slotDurationMinutes: 60,
        slotStrideMinutes: 60,
        minFreeCount: 2,
      }),
    ).toEqual([]);
  });

  it("returns nothing when search window is empty", () => {
    expect(
      findOverlapWindows({
        members: [{ memberId: "m1", searchWindow, busy: [] }],
        searchWindow: { start: utc(2026, 5, 16, 12), end: utc(2026, 5, 16, 12) },
        slotDurationMinutes: 60,
        slotStrideMinutes: 60,
        minFreeCount: 1,
      }),
    ).toEqual([]);
  });

  it("finds a window where everyone is free", () => {
    const sarah: MemberAvailability = {
      memberId: "sarah",
      searchWindow,
      busy: [{ start: utc(2026, 5, 16, 10), end: utc(2026, 5, 16, 12) }],
    };
    const mike: MemberAvailability = {
      memberId: "mike",
      searchWindow,
      busy: [{ start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) }],
    };
    const tunde: MemberAvailability = {
      memberId: "tunde",
      searchWindow,
      busy: [],
    };

    const overlaps = findOverlapWindows({
      members: [sarah, mike, tunde],
      searchWindow,
      slotDurationMinutes: 120,
      slotStrideMinutes: 60,
      minFreeCount: 3,
    });

    // 19:00-21:00 is free for all three.
    const allThreeFree = overlaps.find(
      (w) =>
        w.start.getUTCHours() === 19 &&
        w.end.getUTCHours() === 21 &&
        w.freeMemberIds.length === 3,
    );
    expect(allThreeFree).toBeDefined();
    expect(allThreeFree?.freeMemberIds).toEqual(
      expect.arrayContaining(["sarah", "mike", "tunde"]),
    );
  });

  it("respects minFreeCount", () => {
    const sarah: MemberAvailability = {
      memberId: "sarah",
      searchWindow,
      busy: [{ start: utc(2026, 5, 16, 9), end: utc(2026, 5, 16, 23) }],
    };
    const mike: MemberAvailability = {
      memberId: "mike",
      searchWindow,
      busy: [{ start: utc(2026, 5, 16, 9), end: utc(2026, 5, 16, 23) }],
    };
    const tunde: MemberAvailability = { memberId: "tunde", searchWindow, busy: [] };

    // With minFreeCount=2, no window qualifies (only Tunde is ever free).
    const overlaps = findOverlapWindows({
      members: [sarah, mike, tunde],
      searchWindow,
      slotDurationMinutes: 60,
      slotStrideMinutes: 60,
      minFreeCount: 2,
    });
    expect(overlaps).toEqual([]);
  });

  it("returns busy member IDs alongside free ones", () => {
    const sarah: MemberAvailability = {
      memberId: "sarah",
      searchWindow,
      busy: [{ start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) }],
    };
    const mike: MemberAvailability = {
      memberId: "mike",
      searchWindow,
      busy: [],
    };

    const overlaps = findOverlapWindows({
      members: [sarah, mike],
      searchWindow: { start: utc(2026, 5, 16, 14), end: utc(2026, 5, 16, 16) },
      slotDurationMinutes: 60,
      slotStrideMinutes: 60,
      minFreeCount: 1,
    });

    expect(overlaps).toHaveLength(2);
    for (const w of overlaps) {
      expect(w.freeMemberIds).toEqual(["mike"]);
      expect(w.busyMemberIds).toEqual(["sarah"]);
    }
  });

  it("validates positive slot durations", () => {
    expect(() =>
      findOverlapWindows({
        members: [],
        searchWindow,
        slotDurationMinutes: 0,
        slotStrideMinutes: 60,
        minFreeCount: 1,
      }),
    ).toThrow();

    expect(() =>
      findOverlapWindows({
        members: [],
        searchWindow,
        slotDurationMinutes: 60,
        slotStrideMinutes: -5,
        minFreeCount: 1,
      }),
    ).toThrow();
  });
});
