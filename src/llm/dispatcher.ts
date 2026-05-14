/**
 * Function-call dispatcher.
 *
 * The dispatcher sits between Gemini and the engine. Gemini proposes function
 * calls; this code authorizes, executes, filters, and audits them. Hard rules
 * from CLAUDE.md and SECURITY.md are enforced here, not anywhere upstream:
 *
 * 1. Args from the LLM are validated against a Zod schema before any work happens.
 *    The LLM cannot smuggle arbitrary fields past the type system.
 * 2. Permission checks run on every call, against the caller and session context,
 *    not against any field the LLM proposes. The LLM cannot escalate by lying.
 * 3. Handler output is re-validated against an LLM-safe result schema before being
 *    returned. Defence-in-depth: if a handler accidentally returns a raw DB row,
 *    the result schema strips it.
 * 4. A per-session budget caps how many function calls a single Gemini chain can
 *    make. Without this, an LLM that gets confused can loop forever.
 * 5. Every dispatch (success, failure, or denial) is recorded in the audit log.
 */

import { z } from "zod";
import type { Pool } from "pg";
import type { FunctionName } from "./functions.js";
import type { TokenVault } from "../auth/token-vault.js";

/**
 * Provider interface for reading free/busy from a calendar source. Each
 * provider (Google, Microsoft, iCloud, manual) implements this and gets
 * passed into the dispatcher via DispatchContext.providers. Keeping the
 * interface tight here so handlers don't have to care which provider a
 * member used to connect — they just call get() with the user and the
 * window and get back busy intervals.
 */
export interface FreeBusyProvider {
  /**
   * Returns the user's busy intervals within [windowStart, windowEnd).
   * Throws on transport / auth errors so the caller can decide per-member
   * whether to degrade gracefully or fail the whole run.
   */
  getFreeBusy(input: {
    readonly userId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly signal?: AbortSignal;
  }): Promise<ReadonlyArray<{ readonly start: Date; readonly end: Date }>>;
}

export interface DispatchContext {
  /** Opaque user ID of whoever triggered the chain (e.g. the human who typed /find_time). */
  readonly callerId: string;
  /** The session this call is scoped to. */
  readonly sessionId: string;
  /** Rail the request came in on. Used for audit and per-rail policy if needed. */
  readonly rail: string;
  /**
   * Data layer. Optional so tests that exercise the dispatcher's plumbing
   * (auth, budget, output validation) can construct contexts without a
   * running DB. Handlers that actually need the DB throw a clear error
   * when it's absent.
   */
  readonly db?: Pool;
  /** Token vault for decrypting calendar OAuth tokens. Optional, same reasoning as `db`. */
  readonly vault?: TokenVault;
  /**
   * Map of provider name -> FreeBusyProvider. Handlers look up the
   * provider for each session member based on which one(s) the member
   * connected. Missing entries mean that provider isn't configured at
   * deploy time; handlers degrade gracefully (skip those members).
   */
  readonly providers?: Readonly<Record<string, FreeBusyProvider>>;
}

export type DispatchSuccess<T> = {
  readonly ok: true;
  readonly data: T;
};

export type DispatchFailure = {
  readonly ok: false;
  readonly error: {
    readonly code: DispatchErrorCode;
    readonly message: string;
  };
};

export type DispatchResult<T> = DispatchSuccess<T> | DispatchFailure;

export type DispatchErrorCode =
  | "UNKNOWN_FUNCTION"
  | "INVALID_ARGS"
  | "FORBIDDEN"
  | "BUDGET_EXHAUSTED"
  | "HANDLER_ERROR"
  | "OUTPUT_INVALID";

export interface FunctionHandler<TArgs, TResult> {
  readonly argsSchema: z.ZodType<TArgs>;
  /** Used to re-validate handler output before it reaches the LLM. */
  readonly resultSchema: z.ZodType<TResult>;
  authorize(ctx: DispatchContext, args: TArgs): Promise<boolean> | boolean;
  execute(ctx: DispatchContext, args: TArgs): Promise<TResult>;
}

export interface CallBudget {
  /** Returns true if the call can proceed and reserves one slot in the budget. */
  tryConsume(sessionId: string): boolean;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void> | void;
}

export interface AuditEntry {
  readonly at: Date;
  readonly callerId: string;
  readonly sessionId: string;
  readonly rail: string;
  readonly functionName: string;
  readonly outcome: "ok" | "denied" | "invalid_args" | "unknown" | "budget" | "handler_error" | "output_invalid";
  readonly errorMessage?: string;
}

export class Dispatcher {
  private readonly handlers = new Map<string, FunctionHandler<unknown, unknown>>();

  constructor(
    private readonly budget: CallBudget,
    private readonly audit: AuditSink,
  ) {}

  /**
   * Register a handler for a function name. Generics flow through so that
   * each handler can keep its concrete arg and result types.
   */
  register<TArgs, TResult>(
    name: FunctionName,
    handler: FunctionHandler<TArgs, TResult>,
  ): void {
    this.handlers.set(name, handler as FunctionHandler<unknown, unknown>);
  }

  async dispatch(
    ctx: DispatchContext,
    call: { name: string; args: unknown },
  ): Promise<DispatchResult<unknown>> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      await this.audit.record(makeEntry(ctx, call.name, "unknown"));
      return failure("UNKNOWN_FUNCTION", `No handler for function "${call.name}"`);
    }

    const parsed = handler.argsSchema.safeParse(call.args);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      await this.audit.record(makeEntry(ctx, call.name, "invalid_args", msg));
      return failure("INVALID_ARGS", msg);
    }

    let authorized: boolean;
    try {
      authorized = await handler.authorize(ctx, parsed.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit.record(makeEntry(ctx, call.name, "handler_error", msg));
      return failure("HANDLER_ERROR", msg);
    }
    if (!authorized) {
      await this.audit.record(makeEntry(ctx, call.name, "denied"));
      return failure("FORBIDDEN", "Caller is not authorized for this function on this session");
    }

    if (!this.budget.tryConsume(ctx.sessionId)) {
      await this.audit.record(makeEntry(ctx, call.name, "budget"));
      return failure("BUDGET_EXHAUSTED", "Per-session function-call budget exceeded");
    }

    let rawResult: unknown;
    try {
      rawResult = await handler.execute(ctx, parsed.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit.record(makeEntry(ctx, call.name, "handler_error", msg));
      return failure("HANDLER_ERROR", msg);
    }

    const filtered = handler.resultSchema.safeParse(rawResult);
    if (!filtered.success) {
      const msg = "Handler output failed result-schema validation";
      await this.audit.record(makeEntry(ctx, call.name, "output_invalid", msg));
      return failure("OUTPUT_INVALID", msg);
    }

    await this.audit.record(makeEntry(ctx, call.name, "ok"));
    return { ok: true, data: filtered.data };
  }
}

/**
 * In-memory token-bucket budget. Per session, max N calls per windowMs.
 * Production deployments wire this up to Redis; the interface stays the same.
 */
export class InMemoryCallBudget implements CallBudget {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxCalls: number,
    private readonly windowMs: number,
  ) {}

  tryConsume(sessionId: string): boolean {
    const now = Date.now();
    const bucket = (this.buckets.get(sessionId) ?? []).filter((t) => now - t < this.windowMs);
    if (bucket.length >= this.maxCalls) {
      this.buckets.set(sessionId, bucket);
      return false;
    }
    bucket.push(now);
    this.buckets.set(sessionId, bucket);
    return true;
  }
}

/**
 * Audit sink that writes JSON lines to stderr. Real production sink writes
 * to the audit_log table; same interface. Stderr keeps the dispatcher useful
 * during local development without a database.
 */
export class ConsoleAuditSink implements AuditSink {
  record(entry: AuditEntry): void {
    process.stderr.write(`${JSON.stringify({ kind: "audit", ...entry })}\n`);
  }
}

function failure(code: DispatchErrorCode, message: string): DispatchFailure {
  return { ok: false, error: { code, message } };
}

function makeEntry(
  ctx: DispatchContext,
  functionName: string,
  outcome: AuditEntry["outcome"],
  errorMessage?: string,
): AuditEntry {
  return {
    at: new Date(),
    callerId: ctx.callerId,
    sessionId: ctx.sessionId,
    rail: ctx.rail,
    functionName,
    outcome,
    ...(errorMessage !== undefined && { errorMessage }),
  };
}
