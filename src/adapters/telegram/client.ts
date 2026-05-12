/**
 * Minimal Telegram Bot API client. Native fetch only.
 *
 * Kept thin on purpose: the engine doesn't need 90% of Telegram's API
 * surface, and a slim client is easier to audit than pulling in grammy
 * for what amounts to two HTTP calls.
 *
 * Add methods here only when a feature actually uses them.
 */

import type { TelegramSendMessage } from "./types.js";

export interface TelegramApiClientOptions {
  readonly botToken: string;
  /** Override for tests; defaults to https://api.telegram.org */
  readonly apiBase?: string;
  /** Override for tests; defaults to globalThis.fetch */
  readonly fetchImpl?: typeof fetch;
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly description: string | undefined,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export class TelegramApiClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TelegramApiClientOptions) {
    if (!options.botToken) {
      throw new Error("TelegramApiClient: botToken is required");
    }
    this.base = (options.apiBase ?? "https://api.telegram.org").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async sendMessage(payload: TelegramSendMessage): Promise<void> {
    await this.call("sendMessage", payload);
  }

  private async call(method: string, payload: unknown): Promise<unknown> {
    const url = `${this.base}/bot${this.options.botToken}/${method}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const desc = isTelegramErrorBody(body) ? body.description : undefined;
      throw new TelegramApiError(
        `Telegram API ${method} failed (HTTP ${response.status})`,
        response.status,
        desc,
      );
    }

    if (isTelegramErrorBody(body) && body.ok === false) {
      throw new TelegramApiError(
        `Telegram API ${method} returned ok=false`,
        response.status,
        body.description,
      );
    }

    return body;
  }
}

function isTelegramErrorBody(body: unknown): body is { ok?: boolean; description?: string } {
  return typeof body === "object" && body !== null;
}
