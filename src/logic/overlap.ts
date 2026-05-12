import type { BusySlot, FindOverlapInput, OverlapWindow, TimeWindow } from "./types.js";

/**
 * Find time windows where at least `minFreeCount` members are free.
 *
 * Approach: brute-force scan candidate slots across the search window.
 * For each candidate, check each member against their busy intervals.
 * Trivial complexity for realistic inputs (members <= 20, search window
 * <= 4 weeks, stride >= 30 min) and removes all the edge-case headaches
 * of free-interval arithmetic.
 *
 * Pure function. No I/O. Tested in tests/logic/overlap.test.ts.
 */
export function findOverlapWindows(input: FindOverlapInput): ReadonlyArray<OverlapWindow> {
  const { members, searchWindow, slotDurationMinutes, slotStrideMinutes, minFreeCount } = input;

  if (slotDurationMinutes <= 0) {
    throw new Error("slotDurationMinutes must be positive");
  }
  if (slotStrideMinutes <= 0) {
    throw new Error("slotStrideMinutes must be positive");
  }
  if (searchWindow.end.getTime() <= searchWindow.start.getTime()) {
    return [];
  }
  if (members.length === 0) {
    return [];
  }

  const results: OverlapWindow[] = [];
  const windowStartMs = searchWindow.start.getTime();
  const windowEndMs = searchWindow.end.getTime();
  const slotMs = slotDurationMinutes * 60_000;
  const strideMs = slotStrideMinutes * 60_000;

  for (let t = windowStartMs; t + slotMs <= windowEndMs; t += strideMs) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + slotMs);

    const freeMemberIds: string[] = [];
    const busyMemberIds: string[] = [];

    for (const member of members) {
      if (memberIsFree(member.busy, slotStart, slotEnd)) {
        freeMemberIds.push(member.memberId);
      } else {
        busyMemberIds.push(member.memberId);
      }
    }

    if (freeMemberIds.length >= minFreeCount) {
      results.push({
        start: slotStart,
        end: slotEnd,
        freeMemberIds: Object.freeze(freeMemberIds),
        busyMemberIds: Object.freeze(busyMemberIds),
      });
    }
  }

  return results;
}

/**
 * Whether a member is free across an entire `[slotStart, slotEnd)` window.
 * Free means no busy interval intersects the slot.
 */
export function memberIsFree(
  busy: ReadonlyArray<BusySlot>,
  slotStart: Date,
  slotEnd: Date,
): boolean {
  for (const b of busy) {
    if (intervalsOverlap(b, { start: slotStart, end: slotEnd })) {
      return false;
    }
  }
  return true;
}

/**
 * Half-open interval overlap. `[a.start, a.end)` overlaps `[b.start, b.end)` iff
 * a.start < b.end && b.start < a.end. Touching at a single instant (a.end == b.start)
 * does NOT count as overlap, which is what callers usually want for calendar slots.
 */
export function intervalsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}
