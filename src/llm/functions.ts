/**
 * Function declarations exposed to Gemini in function-calling mode.
 *
 * Hard rules (defined in CLAUDE.md and SECURITY.md):
 * - The LLM never sees user names, calendar event titles, locations, or raw tokens.
 *   Every ID below is opaque (typically a UUID).
 * - Function-calling mode ONLY. There is no chat or free-form generation endpoint
 *   anywhere in the engine. The LLM proposes; the dispatcher authorizes.
 * - Tool outputs are filtered to a whitelist of fields before being returned to the LLM.
 *   See src/llm/dispatcher.ts (forthcoming).
 * - Permission checks happen in the dispatcher, not in the LLM context.
 *
 * These declarations are intentionally tight: each name maps to one concrete
 * action with a typed schema. Anything that would require open-ended reasoning
 * is not a function call — it's a deterministic path in the orchestrator.
 */

export const functionDeclarations = [
  {
    name: "get_availability",
    description:
      "Get free/busy windows for a set of session members within a time range. Returns aggregated availability, never individual calendar event details.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "UUID of the session" },
        memberIds: {
          type: "array",
          items: { type: "string" },
          description: "Opaque UUIDs of members within the session",
        },
        windowStartIso: {
          type: "string",
          description: "ISO-8601 UTC start of the search window",
        },
        windowEndIso: {
          type: "string",
          description: "ISO-8601 UTC end of the search window",
        },
      },
      required: ["sessionId", "memberIds", "windowStartIso", "windowEndIso"],
    },
  },
  {
    name: "propose_times",
    description:
      "Compute and return top N overlap windows ranked by free-member count and time-of-week preferences.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        topN: {
          type: "integer",
          description: "How many top windows to return (1-10)",
        },
        minFreeCount: {
          type: "integer",
          description: "Minimum number of free members required",
        },
      },
      required: ["sessionId", "topN", "minFreeCount"],
    },
  },
  {
    name: "suggest_venue",
    description:
      "Get venue suggestions for a chosen time slot, given an area and intent. Returns scored venue summaries, never proprietary business data.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        windowStartIso: { type: "string" },
        windowEndIso: { type: "string" },
        areaQuery: {
          type: "string",
          description: "Free-text area or city, e.g. 'Lekki' or 'downtown SF'",
        },
        intent: {
          type: "string",
          description: "Free-text intent, e.g. 'movie', 'dinner', 'outdoor'",
        },
        maxResults: { type: "integer" },
      },
      required: ["sessionId", "windowStartIso", "windowEndIso", "areaQuery", "intent"],
    },
  },
  {
    name: "confirm_hangout",
    description:
      "Lock in a chosen time and optionally a venue for the session. Triggers per-member calendar-deeplink delivery via the adapter. Never writes to anyone's calendar directly.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        windowStartIso: { type: "string" },
        windowEndIso: { type: "string" },
        venueId: {
          type: "string",
          description: "Opaque venue ID from suggest_venue, or empty if no venue",
        },
      },
      required: ["sessionId", "windowStartIso", "windowEndIso"],
    },
  },
  {
    name: "send_calendar_link",
    description:
      "Send a personalized calendar deeplink to one session member. The deeplink opens the user's own calendar app with the event prefilled. The bot never holds calendar write access by default.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        memberId: { type: "string" },
      },
      required: ["sessionId", "memberId"],
    },
  },
  {
    name: "list_session_members",
    description:
      "List opaque member IDs in a session with their participation status (connected, pending, declined). Returns no names, no phone numbers, no calendar contents.",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    },
  },
] as const;

export type FunctionName = (typeof functionDeclarations)[number]["name"];
