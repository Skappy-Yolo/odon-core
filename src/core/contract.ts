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
  readonly text: string;
  /** Original platform payload, for adapters that need to look back at things normalize didn't capture. */
  readonly raw: unknown;
}

export interface OutgoingMessage {
  /** Target the platform sees: either a user (DM) or a group (broadcast). */
  readonly target:
    | { readonly kind: "user"; readonly rail: RailId; readonly platformUserId: string }
    | { readonly kind: "group"; readonly rail: RailId; readonly platformGroupId: string };
  readonly text: string;
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
