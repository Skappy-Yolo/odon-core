import { z } from "zod";
import type { DispatchContext, FunctionHandler } from "../dispatcher.js";
import { findOverlapWindows } from "../../logic/overlap.js";
import { rankOverlapWindows } from "../../logic/ranking.js";
import type { MemberAvailability } from "../../logic/types.js";

const argsSchema = z.object({
  sessionId: z.string().uuid(),
  topN: z.number().int().min(1).max(10),
  minFreeCount: z.number().int().min(1),
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
});

type Args = z.infer<typeof argsSchema>;
type Result = z.infer<typeof resultSchema>;

/**
 * Compute and return top N overlap windows. Wired to the real overlap
 * detector + ranking, with mock member availability data for now. The
 * data-layer integration replaces the mock with calendar.freebusy reads
 * once src/db and src/providers land.
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

  async execute(_ctx: DispatchContext, args: Args): Promise<Result> {
    const mockMembers = mockMemberAvailability();

    const overlaps = findOverlapWindows({
      members: mockMembers,
      searchWindow: searchWindowFromMockData(mockMembers),
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
    };
  },
};

/**
 * Temporary mock data. Replaced by real calendar.freebusy reads once the
 * providers layer is in place. Kept inside the handler so the rest of the
 * code is free of mock concerns.
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

function searchWindowFromMockData(
  members: ReadonlyArray<MemberAvailability>,
): { start: Date; end: Date } {
  const first = members[0];
  if (!first) {
    const now = new Date();
    return { start: now, end: new Date(now.getTime() + 86_400_000) };
  }
  return first.searchWindow;
}
