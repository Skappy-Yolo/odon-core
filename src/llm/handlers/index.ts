import type { Dispatcher } from "../dispatcher.js";
import { listSessionMembersHandler } from "./list-session-members.js";
import { proposeTimesHandler } from "./propose-times.js";

/**
 * Register all available function handlers with a dispatcher.
 *
 * Adding a new function: write a handler file in this folder, import it here,
 * and add one `dispatcher.register(...)` line. Tests should cover at least the
 * authorize + execute + result-schema paths.
 */
export function registerAllHandlers(dispatcher: Dispatcher): void {
  dispatcher.register("list_session_members", listSessionMembersHandler);
  dispatcher.register("propose_times", proposeTimesHandler);
  // get_availability, suggest_venue, confirm_hangout, send_calendar_link
  // are still pending. They are declared in src/llm/functions.ts but will
  // fail with UNKNOWN_FUNCTION until their handlers land.
}

export { listSessionMembersHandler } from "./list-session-members.js";
export { proposeTimesHandler } from "./propose-times.js";
