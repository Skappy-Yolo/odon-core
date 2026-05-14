import type {
  Adapter,
  IncomingMessage,
  OutgoingMessage,
  RailId,
} from "../../core/contract.js";
import { TelegramApiClient } from "./client.js";
import { normalizeTelegramUpdate } from "./normalize.js";
import { verifyTelegramSignature } from "./signature.js";
import type { TelegramSendMessage, TelegramUpdate } from "./types.js";

export interface TelegramAdapterOptions {
  readonly botToken: string;
  readonly webhookSecretToken: string;
  /** Test seam; defaults to a TelegramApiClient built from botToken. */
  readonly client?: TelegramApiClient;
}

export class TelegramAdapter implements Adapter {
  readonly rail: RailId = "telegram";
  private readonly client: TelegramApiClient;

  constructor(private readonly options: TelegramAdapterOptions) {
    this.client = options.client ?? new TelegramApiClient({ botToken: options.botToken });
  }

  verifyWebhookSignature(
    headers: Readonly<Record<string, string>>,
    _body: string,
  ): boolean {
    return verifyTelegramSignature(headers, {
      expectedSecretToken: this.options.webhookSecretToken,
    });
  }

  normalize(rawWebhook: unknown): IncomingMessage | null {
    if (!isTelegramUpdate(rawWebhook)) return null;
    return normalizeTelegramUpdate(rawWebhook);
  }

  async send(message: OutgoingMessage): Promise<void> {
    const chatId = chatIdFromTarget(message.target);
    if (chatId === null) {
      throw new Error("TelegramAdapter.send: target rail mismatch");
    }

    const payload: TelegramSendMessage = {
      chat_id: chatId,
      text: message.text,
      ...(message.format === "html" ? { parse_mode: "HTML" as const } : {}),
      ...(message.format === "markdown" ? { parse_mode: "Markdown" as const } : {}),
      ...(message.buttons && message.buttons.length > 0
        ? {
            reply_markup: {
              inline_keyboard: [
                message.buttons.map((b) => ({ text: b.label, callback_data: b.value })),
              ],
            },
          }
        : {}),
    };

    await this.client.sendMessage(payload);
  }
}

function chatIdFromTarget(target: OutgoingMessage["target"]): number | null {
  if (target.rail !== "telegram") return null;
  const raw = target.kind === "user" ? target.platformUserId : target.platformGroupId;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { update_id?: unknown }).update_id === "number"
  );
}
