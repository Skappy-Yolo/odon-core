import { z } from "zod";
import type { DispatchContext, FunctionHandler } from "../dispatcher.js";
import { listSessionMembers } from "../../db/queries.js";

const argsSchema = z.object({
  sessionId: z.string().uuid(),
});

const memberStatus = z.enum(["connected", "pending", "declined"]);

const resultSchema = z.object({
  members: z.array(
    z.object({
      memberId: z.string().uuid(),
      status: memberStatus,
      hasCalendar: z.boolean(),
    }),
  ),
});

type Args = z.infer<typeof argsSchema>;
type Result = z.infer<typeof resultSchema>;

const MOCK_RESPONSE: Result = {
  members: [
    { memberId: "00000000-0000-0000-0000-000000000001", status: "connected", hasCalendar: true },
    { memberId: "00000000-0000-0000-0000-000000000002", status: "connected", hasCalendar: true },
    { memberId: "00000000-0000-0000-0000-000000000003", status: "pending", hasCalendar: false },
  ],
};

/**
 * Lists opaque member IDs in a session with their participation status and
 * whether they have at least one calendar provider connected. Returns NO
 * names, NO phone numbers, NO calendar contents.
 *
 * When `ctx.db` is available, queries the real session_members + users
 * join from Postgres. When `ctx.db` is missing (DB-less dev or tests),
 * falls back to a canned response so the dispatcher can still be
 * exercised end-to-end without infrastructure.
 */
export const listSessionMembersHandler: FunctionHandler<Args, Result> = {
  argsSchema,
  resultSchema,

  authorize(ctx: DispatchContext, args: Args): boolean {
    // Permission rule (stub): caller must reference the same session they
    // claim membership in. Real check (caller is a member of session,
    // session is open) lives behind the data layer.
    return args.sessionId === ctx.sessionId;
  },

  async execute(ctx: DispatchContext, args: Args): Promise<Result> {
    if (!ctx.db) return MOCK_RESPONSE;

    const rows = await listSessionMembers(ctx.db, args.sessionId);
    return {
      members: rows.map((r) => ({
        memberId: r.userId,
        status: r.status,
        hasCalendar: r.hasCalendar,
      })),
    };
  },
};
