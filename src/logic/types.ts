/**
 * Types for the pure-logic layer. No I/O. No LLM. Everything in src/logic
 * must be deterministic and unit-testable.
 *
 * All IDs are opaque strings (typically UUIDs). The pure-logic layer NEVER sees
 * user names, calendar event titles, or any other PII. That's the privacy
 * boundary defined in the architecture doc.
 */

export interface TimeWindow {
  readonly start: Date;
  readonly end: Date;
}

export interface BusySlot extends TimeWindow {}

export interface MemberAvailability {
  /** Opaque member ID. Never a real name. */
  readonly memberId: string;
  /** The search window this availability was computed for. */
  readonly searchWindow: TimeWindow;
  /** Busy intervals reported by the member's calendar within the search window. */
  readonly busy: ReadonlyArray<BusySlot>;
}

export interface OverlapWindow extends TimeWindow {
  /** Opaque member IDs free during this window. */
  readonly freeMemberIds: ReadonlyArray<string>;
  /** Opaque member IDs busy during this window. */
  readonly busyMemberIds: ReadonlyArray<string>;
}

export interface RankedOverlap extends OverlapWindow {
  readonly score: number;
}

export interface FindOverlapInput {
  readonly members: ReadonlyArray<MemberAvailability>;
  readonly searchWindow: TimeWindow;
  /** Length of each candidate slot in minutes. Typical: 60 or 120. */
  readonly slotDurationMinutes: number;
  /** How far apart consecutive candidate slots start, in minutes. Typical: 30 or 60. */
  readonly slotStrideMinutes: number;
  /** Minimum number of free members required for a window to be returned. Defaults to 2. */
  readonly minFreeCount: number;
}
