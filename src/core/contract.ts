/**
 * Adapter contract.
 * Every rail (Telegram, WhatsApp Cloud, OpenClaw skill, Discord, web) implements
 * this interface against the engine. The engine never talks directly to a platform.
 */

export interface User {
  readonly id: string;
  readonly displayName: string;
  readonly rail: RailId;
  readonly platformUserId: string;
}

export interface GroupContext {
  readonly id: string;
  readonly rail: RailId;
  readonly platformGroupId: string;
  readonly displayName: string;
}

export interface Session {
  readonly id: string;
  readonly groupId: string;
  readonly initiatorUserId: string;
  readonly label: string;
  readonly deadline: Date;
  readonly passwordHash: string | null;
  readonly status: SessionStatus;
}

export type SessionStatus = "open" | "computing" | "voting" | "closed" | "cancelled";

export type RailId =
  | "telegram"
  | "whatsapp-cloud"
  | "whatsapp-baileys"
  | "discord"
  | "openclaw"
  | "web";

export interface IncomingMessage {
  readonly rail: RailId;
  readonly receivedAt: Date;
  readonly user: User;
  readonly group: GroupContext | null;
  readonly text: string;
  readonly raw: unknown;
}

export interface OutgoingMessage {
  readonly target: User | GroupContext;
  readonly text: string;
  readonly buttons?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}

export interface Adapter {
  readonly rail: RailId;
  send(message: OutgoingMessage): Promise<void>;
  verifyWebhookSignature(headers: Readonly<Record<string, string>>, body: string): boolean;
  normalize(rawWebhook: unknown): IncomingMessage;
}
