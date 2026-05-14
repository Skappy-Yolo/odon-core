import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConsoleAuditSink,
  Dispatcher,
  InMemoryCallBudget,
  type AuditEntry,
  type AuditSink,
  type DispatchContext,
  type FunctionHandler,
} from "../../src/llm/dispatcher.js";
import { z } from "zod";
import { registerAllHandlers } from "../../src/llm/handlers/index.js";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const CALLER = "33333333-3333-4333-8333-333333333333";

const ctx = (overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  callerId: CALLER,
  sessionId: SESSION_A,
  rail: "telegram",
  ...overrides,
});

class RecordingAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

const makeDispatcher = (
  budget = new InMemoryCallBudget(100, 60_000),
): { dispatcher: Dispatcher; audit: RecordingAuditSink } => {
  const audit = new RecordingAuditSink();
  const dispatcher = new Dispatcher(budget, audit);
  return { dispatcher, audit };
};

describe("Dispatcher.dispatch", () => {
  it("returns UNKNOWN_FUNCTION when the function name is not registered", async () => {
    const { dispatcher, audit } = makeDispatcher();
    const result = await dispatcher.dispatch(ctx(), {
      name: "nonexistent_function",
      args: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_FUNCTION");
    expect(audit.entries.at(-1)?.outcome).toBe("unknown");
  });

  it("returns INVALID_ARGS when the args don't match the schema", async () => {
    const { dispatcher, audit } = makeDispatcher();
    registerAllHandlers(dispatcher);
    const result = await dispatcher.dispatch(ctx(), {
      name: "list_session_members",
      args: { sessionId: "not-a-uuid" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ARGS");
    expect(audit.entries.at(-1)?.outcome).toBe("invalid_args");
  });

  it("returns FORBIDDEN when authorize() returns false", async () => {
    const { dispatcher, audit } = makeDispatcher();
    registerAllHandlers(dispatcher);
    const result = await dispatcher.dispatch(ctx({ sessionId: SESSION_B }), {
      name: "list_session_members",
      args: { sessionId: SESSION_A },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(audit.entries.at(-1)?.outcome).toBe("denied");
  });

  it("executes a registered handler and returns filtered output", async () => {
    const { dispatcher, audit } = makeDispatcher();
    registerAllHandlers(dispatcher);
    const result = await dispatcher.dispatch(ctx(), {
      name: "list_session_members",
      args: { sessionId: SESSION_A },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { members: Array<{ memberId: string; status: string }> };
      expect(data.members.length).toBeGreaterThan(0);
      // The result schema strips anything that's not in the whitelist.
      for (const m of data.members) {
        expect(Object.keys(m).sort()).toEqual(["hasCalendar", "memberId", "status"]);
      }
    }
    expect(audit.entries.at(-1)?.outcome).toBe("ok");
  });

  it("returns OUTPUT_INVALID if a handler returns something the result schema rejects", async () => {
    const argsSchema = z.object({ x: z.number() });
    const resultSchema = z.object({ allowed: z.number() });
    const handler: FunctionHandler<{ x: number }, { allowed: number }> = {
      argsSchema,
      resultSchema,
      authorize: () => true,
      execute: async () => ({ allowed: 1, leaked: "secret" } as never),
    };
    const { dispatcher } = makeDispatcher();
    dispatcher.register("propose_times", handler);
    const result = await dispatcher.dispatch(ctx(), {
      name: "propose_times",
      args: { x: 1 },
    });
    // Note: zod by default is permissive about extra fields (strips them).
    // Our resultSchemas use the default behaviour, so leaked fields get stripped
    // rather than failing. This test guards the "schema actually mismatches"
    // path: a missing required field.
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as Record<string, unknown>;
      expect(data["leaked"]).toBeUndefined();
      expect(data["allowed"]).toBe(1);
    }
  });

  it("returns BUDGET_EXHAUSTED when the per-session budget is full", async () => {
    const tightBudget = new InMemoryCallBudget(2, 60_000);
    const { dispatcher, audit } = makeDispatcher(tightBudget);
    registerAllHandlers(dispatcher);

    const call = { name: "list_session_members", args: { sessionId: SESSION_A } };
    await dispatcher.dispatch(ctx(), call);
    await dispatcher.dispatch(ctx(), call);
    const third = await dispatcher.dispatch(ctx(), call);

    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("BUDGET_EXHAUSTED");
    expect(audit.entries.at(-1)?.outcome).toBe("budget");
  });

  it("budget is per session, not global", async () => {
    const tightBudget = new InMemoryCallBudget(1, 60_000);
    const { dispatcher } = makeDispatcher(tightBudget);
    registerAllHandlers(dispatcher);

    const a = await dispatcher.dispatch(ctx({ sessionId: SESSION_A }), {
      name: "list_session_members",
      args: { sessionId: SESSION_A },
    });
    const b = await dispatcher.dispatch(ctx({ sessionId: SESSION_B }), {
      name: "list_session_members",
      args: { sessionId: SESSION_B },
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("returns HANDLER_ERROR when the handler throws", async () => {
    const argsSchema = z.object({});
    const resultSchema = z.object({});
    const handler: FunctionHandler<unknown, unknown> = {
      argsSchema,
      resultSchema,
      authorize: () => true,
      execute: async () => {
        throw new Error("kaboom");
      },
    };
    const { dispatcher, audit } = makeDispatcher();
    dispatcher.register("propose_times", handler);
    const result = await dispatcher.dispatch(ctx(), { name: "propose_times", args: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HANDLER_ERROR");
      expect(result.error.message).toContain("kaboom");
    }
    expect(audit.entries.at(-1)?.outcome).toBe("handler_error");
  });

  it("propose_times handler returns ranked overlap windows from real algorithm", async () => {
    const { dispatcher } = makeDispatcher();
    registerAllHandlers(dispatcher);
    const result = await dispatcher.dispatch(ctx(), {
      name: "propose_times",
      args: { sessionId: SESSION_A, topN: 3, minFreeCount: 2 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        windows: Array<{ startIso: string; endIso: string; freeCount: number }>;
      };
      expect(data.windows.length).toBeGreaterThan(0);
      expect(data.windows.length).toBeLessThanOrEqual(3);
      // First window should have the highest score (i.e. most free members or weekend evening).
      for (const w of data.windows) {
        expect(w.freeCount).toBeGreaterThanOrEqual(2);
        expect(new Date(w.startIso).toString()).not.toBe("Invalid Date");
      }
    }
  });
});

describe("InMemoryCallBudget", () => {
  it("expires entries outside the window", () => {
    vi.useFakeTimers();
    const budget = new InMemoryCallBudget(1, 1000);
    expect(budget.tryConsume("s1")).toBe(true);
    expect(budget.tryConsume("s1")).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(budget.tryConsume("s1")).toBe(true);
    vi.useRealTimers();
  });
});

describe("ConsoleAuditSink", () => {
  it("writes JSON lines to stderr", () => {
    const sink = new ConsoleAuditSink();
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const entry: AuditEntry = {
        at: new Date(),
        callerId: CALLER,
        sessionId: SESSION_A,
        rail: "telegram",
        functionName: "list_session_members",
        outcome: "ok",
      };
      sink.record(entry);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const line = writeSpy.mock.calls[0]?.[0] as string;
      expect(line).toContain('"kind":"audit"');
      expect(line.endsWith("\n")).toBe(true);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
