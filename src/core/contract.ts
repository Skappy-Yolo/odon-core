/**
 * Adapter contract.
 * Every rail (Telegram, WhatsApp Cloud, OpenClaw skill, Discord, web) implements
 * this interface against the engine. The engine never talks directly to a platform.
 */

export type RailId =
  | "telegram"
  | "whatsapp-cloud"
  | "whatsapp-baileys"
  | "discord"
  | "openclaw"
  | "web";

/**
 * What an adapter knows about a user from the platform alone. No engine
 * internal ID, because the adapter has no DB access; the engine resolves
 * or creates the internal user record after the message is normalized.
 */
export interface IncomingUser {
  readonly rail: RailId;
  readonly platformUserId: string;
  readonly displayName: string;
}

/**
 * What an adapter knows about a group from the platform alone. Same
 * resolve-after-receive pattern as IncomingUser.
 */
export interface IncomingGroup {
  readonly rail: RailId;
  readonly platformGroupId: string;
  readonly displayName: string;
}

/** Engine-resolved user. Includes the internal UUID from the users table. */
export interface User extends IncomingUser {
  readonly id: string;
}

/** Engine-resolved group. Includes the internal UUID from the groups table. */
export interface GroupContext extends IncomingGroup {
  readonly id: string;
}

export interface Session {
  readonly id: string;
  readonly shortCode: string;
  readonly groupId: string;
  readonly initiatorUserId: string;
  readonly label: string;
  readonly deadline: Date;
  readonly passwordHash: string | null;
  readonly status: SessionStatus;
}

export type SessionStatus = "open" | "computing" | "voting" | "closed" | "cancelled";

export interface IncomingMessage {
  readonly rail: RailId;
  readonly receivedAt: Date;
  readonly user: IncomingUser;
  readonly group: IncomingGroup | null;
  /**
   * Text body for normal messages. Empty string for pure button presses
   * (the actual payload then lives in `callback.data`).
   */
  readonly text: string;
  /**
   * Set when this update is a callback query (e.g. user tapped an inline
   * keyboard button on Telegram). The router branches on this:
   *   - if callback is set, treat `callback.data` as the action payload
   *     (e.g. "vote.<session_id>.<window_idx>.<hmac>")
   *   - if callback is null/undefined, parse `text` as a slash command
   *
   * Rails that don't have this concept (e.g. WhatsApp Cloud) won't ever
   * set it. The field is optional so they can omit it cleanly.
   */
  readonly callback?: {
    /** The callback_data string the bot set on the button. */
    readonly data: string;
    /**
     * Platform-specific callback ID. The adapter uses it to acknowledge
     * the callback within the platform's deadline (Telegram requires
     * `answerCallbackQuery` within ~3 seconds or it retries the update).
     */
    readonly queryId: string;
  };
  /** Original platform payload, for adapters that need to look back at things normalize didn't capture. */
  readonly raw: unknown;
}

export interface OutgoingMessage {
  /** Target the platform sees: either a user (DM) or a group (broadcast). */
  readonly target:
    | { readonly kind: "user"; readonly rail: RailId; readonly platformUserId: string }
    | { readonly kind: "group"; readonly rail: RailId; readonly platformGroupId: string };
  readonly text: string;
  /**
   * How `text` should be interpreted. Each adapter maps to its rail's
   * native formatting. Default is "plain" (no formatting). "html" is the
   * safest cross-rail choice because tag escaping is unambiguous.
   * Note: callers using "html" must HTML-escape dynamic content; the
   * adapter does not re-escape.
   */
  readonly format?: "plain" | "html" | "markdown";
  readonly buttons?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}

export interface Adapter {
  readonly rail: RailId;
  send(message: OutgoingMessage): Promise<void>;
  /** Verify HMAC / secret-token / signature on a webhook payload. */
  verifyWebhookSignature(headers: Readonly<Record<string, string>>, body: string): boolean;
  /** Turn the rail's update format into an IncomingMessage. */
  normalize(rawWebhook: unknown): IncomingMessage | null;
}
