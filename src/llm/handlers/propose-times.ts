import { z } from "zod";
import type { DispatchContext, FreeBusyProvider, FunctionHandler } from "../dispatcher.js";
import { findOverlapWindows } from "../../logic/overlap.js";
import { rankOverlapWindows } from "../../logic/ranking.js";
import type { MemberAvailability } from "../../logic/types.js";
import { findSessionByShortCode, listSessionMembers } from "../../db/queries.js";
import type { Pool } from "pg";

const argsSchema = z.object({
  sessionId: z.string().uuid(),
  topN: z.number().int().min(1).max(10),
  minFreeCount: z.number().int().min(1),
  /**
   * Optional search window override. When omitted, the handler picks a
   * default window (now -> now + 7 days). Useful for tests.
   */
  windowStartIso: z.string().optional(),
  windowEndIso: z.string().optional(),
});

const resultSchema = z.object({
  windows: z.array(
    z.object({
      startIso: z.string(),
      endIso: z.string(),
      freeMemberIds: z.array(z.string()),
      freeCount: z.number().int().min(0),
    }),
  ),
  /** Member IDs whose free/busy fetch failed; they're excluded from the windows. */
  unreachableMemberIds: z.array(z.string()),
});

type Args = z.infer<typeof argsSchema>;
type Result = z.infer<typeof resultSchema>;

/**
 * Compute and return top N overlap windows.
 *
 * Two execution paths:
 *
 * 1. Production: ctx.db + ctx.providers.google present.
 *    - Looks up session_members from the DB
 *    - For each connected member, calls the provider's getFreeBusy in
 *      parallel via Promise.allSettled so partial failures don't sink
 *      the whole run
 *    - Members whose fetch fails are returned in `unreachableMemberIds`
 *      and excluded from overlap; the LLM (or downstream code) can
 *      decide to DM them about re-auth
 *    - Runs the pure overlap detector + ranker
 *
 * 2. Test / DB-less dev: ctx.db missing.
 *    - Returns canned mock data so the dispatcher's plumbing tests work
 *      without infrastructure
 *
 * The LLM-safe result intentionally omits busy member IDs: the LLM
 * doesn't need them, and excluding them shrinks the prompt context.
 */
export const proposeTimesHandler: FunctionHandler<Args, Result> = {
  argsSchema,
  resultSchema,

  authorize(ctx: DispatchContext, args: Args): boolean {
    return args.sessionId === ctx.sessionId;
  },

  async execute(ctx: DispatchContext, args: Args): Promise<Result> {
    const searchWindow = pickSearchWindow(args);

    if (ctx.db && ctx.providers?.["google"]) {
      return runWithProviders(ctx.db, ctx.providers["google"], args, searchWindow);
    }

    // Fallback: canned mock for tests / DB-less dev.
    return runWithMockData(args);
  },
};

async function runWithProviders(
  db: Pool,
  google: FreeBusyProvider,
  args: Args,
  searchWindow: { start: Date; end: Date },
): Promise<Result> {
  const members = await listSessionMembers(db, args.sessionId);

  // Members with no connected provider can't contribute free/busy data.
  // For now we silently exclude them; a later commit DMs them to connect.
  const connected = members.filter((m) => m.hasCalendar && m.providers.includes("google"));

  // Fan out free/busy fetches in parallel; capture partial failures.
  const results = await Promise.allSettled(
    connected.map(async (m) => ({
      memberId: m.userId,
      busy: await google.getFreeBusy({
        userId: m.userId,
        windowStart: searchWindow.start,
        windowEnd: searchWindow.end,
      }),
    })),
  );

  const availability: MemberAvailability[] = [];
  const unreachable: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const member = connected[i];
    const r = results[i];
    if (!member || !r) continue;
    if (r.status === "fulfilled") {
      availability.push({
        memberId: member.userId,
        searchWindow,
        busy: r.value.busy,
      });
    } else {
      unreachable.push(member.userId);
    }
  }

  if (availability.length === 0) {
    return { windows: [], unreachableMemberIds: unreachable };
  }

  const overlaps = findOverlapWindows({
    members: availability,
    searchWindow,
    slotDurationMinutes: 120,
    slotStrideMinutes: 60,
    minFreeCount: args.minFreeCount,
  });

  const ranked = rankOverlapWindows(overlaps);

  return {
    windows: ranked.slice(0, args.topN).map((w) => ({
      startIso: w.start.toISOString(),
      endIso: w.end.toISOString(),
      freeMemberIds: w.freeMemberIds.slice(),
      freeCount: w.freeMemberIds.length,
    })),
    unreachableMemberIds: unreachable,
  };
}

function runWithMockData(args: Args): Result {
  const mockMembers = mockMemberAvailability();

  const overlaps = findOverlapWindows({
    members: mockMembers,
    searchWindow: mockMembers[0]?.searchWindow ?? defaultWindow(),
    slotDurationMinutes: 120,
    slotStrideMinutes: 60,
    minFreeCount: args.minFreeCount,
  });

  const ranked = rankOverlapWindows(overlaps);

  return {
    windows: ranked.slice(0, args.topN).map((w) => ({
      startIso: w.start.toISOString(),
      endIso: w.end.toISOString(),
      freeMemberIds: w.freeMemberIds.slice(),
      freeCount: w.freeMemberIds.length,
    })),
    unreachableMemberIds: [],
  };
}

function pickSearchWindow(args: Args): { start: Date; end: Date } {
  if (args.windowStartIso && args.windowEndIso) {
    return { start: new Date(args.windowStartIso), end: new Date(args.windowEndIso) };
  }
  return defaultWindow();
}

function defaultWindow(): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: now, end };
}

/**
 * Canned mock for tests / DB-less dev. Kept inside the handler so the
 * rest of the code is free of mock concerns. When ctx.db lands the real
 * path takes over and this is never called in production.
 */
function mockMemberAvailability(): ReadonlyArray<MemberAvailability> {
  const day = new Date(Date.UTC(2026, 4, 16)); // Saturday May 16, 2026, UTC
  const at = (h: number, m = 0): Date => new Date(day.getTime() + (h * 60 + m) * 60_000);
  const searchWindow = { start: at(9), end: at(23) };

  return [
    {
      memberId: "00000000-0000-0000-0000-000000000001",
      searchWindow,
      busy: [{ start: at(10), end: at(12) }],
    },
    {
      memberId: "00000000-0000-0000-0000-000000000002",
      searchWindow,
      busy: [{ start: at(14), end: at(16) }],
    },
    {
      memberId: "00000000-0000-0000-0000-000000000003",
      searchWindow,
      busy: [],
    },
  ];
}

// Re-export findSessionByShortCode so callers that need it after listSessionMembers
// can reach it via this module — small ergonomic shortcut, unrelated to handler logic.
export { findSessionByShortCode };
