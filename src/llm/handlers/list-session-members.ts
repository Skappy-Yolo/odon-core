import { z } from "zod";
import type { DispatchContext, FunctionHandler } from "../dispatcher.js";

const argsSchema = z.object({
  sessionId: z.string().uuid(),
});

const memberStatus = z.enum(["connected", "pending", "declined"]);

const resultSchema = z.object({
  members: z.array(
    z.object({
      memberId: z.string().uuid(),
      status: memberStatus,
    }),
  ),
});

type Args = z.infer<typeof argsSchema>;
type Result = z.infer<typeof resultSchema>;

/**
 * Lists opaque member IDs in a session with their participation status.
 * Returns NO names, NO phone numbers, NO calendar contents.
 *
 * Stub implementation. Will be wired to the real data layer (src/db) when
 * the schema lands. For now, returns a canned response so the dispatcher
 * can be exercised end to end.
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

  async execute(_ctx: DispatchContext, _args: Args): Promise<Result> {
    return {
      members: [
        { memberId: "00000000-0000-0000-0000-000000000001", status: "connected" },
        { memberId: "00000000-0000-0000-0000-000000000002", status: "connected" },
        { memberId: "00000000-0000-0000-0000-000000000003", status: "pending" },
      ],
    };
  },
};
