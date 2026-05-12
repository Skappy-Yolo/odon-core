import { describe, expect, it } from "vitest";
import { rankOverlapWindows, scoreWindow } from "../../src/logic/ranking.js";
import type { OverlapWindow } from "../../src/logic/types.js";

const utc = (yyyy: number, mm: number, dd: number, hh = 0): Date =>
  new Date(Date.UTC(yyyy, mm - 1, dd, hh));

function window(
  start: Date,
  hours: number,
  freeMemberIds: ReadonlyArray<string>,
): OverlapWindow {
  return {
    start,
    end: new Date(start.getTime() + hours * 60 * 60_000),
    freeMemberIds,
    busyMemberIds: [],
  };
}

// Reference "now" used in all proximity-scoring tests so they don't drift with real time.
const NOW = utc(2026, 5, 12, 12);

describe("scoreWindow", () => {
  it("rewards more free members the most", () => {
    // Compare windows on the same day/hour, different free counts.
    const local = (h: number, freeCount: number) =>
      window(
        new Date(2026, 4, 16, h),
        2,
        Array.from({ length: freeCount }, (_, i) => `m${i}`),
      );
    const two = scoreWindow(local(14, 2), NOW.getTime());
    const four = scoreWindow(local(14, 4), NOW.getTime());
    expect(four - two).toBeGreaterThanOrEqual(100);
  });

  it("prefers Saturday over Sunday over weekday at the same hour", () => {
    const localAt = (date: Date) => window(date, 2, ["a", "b"]);
    // 19:00 local on each day.
    const sat = scoreWindow(localAt(new Date(2026, 4, 16, 19)), NOW.getTime());
    const sun = scoreWindow(localAt(new Date(2026, 4, 17, 19)), NOW.getTime());
    const wed = scoreWindow(localAt(new Date(2026, 4, 20, 19)), NOW.getTime());
    expect(sat).toBeGreaterThan(sun);
    expect(sun).toBeGreaterThan(wed);
  });

  it("prefers evenings over afternoons over brunch (same day)", () => {
    const sameDay = (hour: number) => window(new Date(2026, 4, 16, hour), 2, ["a", "b"]);
    const evening = scoreWindow(sameDay(19), NOW.getTime());
    const afternoon = scoreWindow(sameDay(15), NOW.getTime());
    const brunch = scoreWindow(sameDay(12), NOW.getTime());
    expect(evening).toBeGreaterThan(afternoon);
    expect(afternoon).toBeGreaterThan(brunch);
  });

  it("penalises early mornings and late nights", () => {
    const sameDay = (hour: number) => window(new Date(2026, 4, 16, hour), 2, ["a", "b"]);
    const morning = scoreWindow(sameDay(7), NOW.getTime());
    const lateNight = scoreWindow(sameDay(23), NOW.getTime());
    const afternoon = scoreWindow(sameDay(15), NOW.getTime());
    expect(afternoon).toBeGreaterThan(morning);
    expect(afternoon).toBeGreaterThan(lateNight);
  });
});

describe("rankOverlapWindows", () => {
  it("sorts highest score first", () => {
    const windows: OverlapWindow[] = [
      window(new Date(2026, 4, 19, 7), 2, ["a", "b"]), // Tuesday early morning
      window(new Date(2026, 4, 16, 19), 2, ["a", "b", "c", "d"]), // Saturday evening, 4 free
      window(new Date(2026, 4, 17, 15), 2, ["a", "b"]), // Sunday afternoon
    ];
    const ranked = rankOverlapWindows(windows, { now: NOW });
    expect(ranked[0]?.freeMemberIds.length).toBe(4);
    expect(ranked[2]?.start.getHours()).toBe(7);
  });

  it("returns a stable result when called with the same fixed `now`", () => {
    const windows: OverlapWindow[] = [
      window(new Date(2026, 4, 16, 19), 2, ["a", "b"]),
      window(new Date(2026, 4, 17, 15), 2, ["a", "b"]),
    ];
    const a = rankOverlapWindows(windows, { now: NOW });
    const b = rankOverlapWindows(windows, { now: NOW });
    expect(a.map((w) => w.score)).toEqual(b.map((w) => w.score));
  });
});
