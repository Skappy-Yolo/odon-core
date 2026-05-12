import type { OverlapWindow, RankedOverlap } from "./types.js";

export interface RankingOptions {
  /** Reference "now" for proximity scoring. Defaults to current time. */
  readonly now?: Date;
}

/**
 * Rank overlap windows by a weighted score that prefers:
 * - more free members (dominant factor)
 * - weekends, evenings, Friday evenings
 * - sooner rather than later
 *
 * Penalizes early mornings and late nights. Heuristic, deliberately small.
 * Pure function. No I/O.
 */
export function rankOverlapWindows(
  windows: ReadonlyArray<OverlapWindow>,
  options: RankingOptions = {},
): RankedOverlap[] {
  const nowMs = (options.now ?? new Date()).getTime();

  return windows
    .map((w) => ({ ...w, score: scoreWindow(w, nowMs) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Exported for testing. The shape of this function is intentionally simple
 * because every constant is a product decision, not an engineering one.
 */
export function scoreWindow(window: OverlapWindow, nowMs: number): number {
  let score = 0;

  const day = window.start.getDay();
  const hour = window.start.getHours();
  const freeCount = window.freeMemberIds.length;

  score += freeCount * 100;

  if (day === 6) score += 30;
  if (day === 0) score += 25;
  if (day === 5 && hour >= 17) score += 20;

  if (hour >= 18 && hour <= 21) score += 15;
  else if (hour >= 14 && hour <= 17) score += 8;
  else if (hour >= 11 && hour <= 13) score += 5;

  const daysAway = Math.floor((window.start.getTime() - nowMs) / (1000 * 60 * 60 * 24));
  if (daysAway >= 0) {
    score += Math.max(0, 7 - daysAway);
  }

  if (hour < 10) score -= 8;
  if (hour >= 22) score -= 5;

  return score;
}
