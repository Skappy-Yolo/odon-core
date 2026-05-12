/**
 * One-shot script that registers the bot's webhook with Telegram.
 *
 * Usage:
 *   npm run telegram:set-webhook
 *
 * Reads these env vars:
 *   TELEGRAM_BOT_TOKEN        (required) — token from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET   (required) — must match what the server uses
 *   ODON_PUBLIC_URL           (required) — public HTTPS URL where odon-core
 *                                          is reachable (e.g. https://odon.fly.dev)
 *
 * What this does:
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *     {
 *       url: "<ODON_PUBLIC_URL>/webhook/telegram",
 *       secret_token: "<TELEGRAM_WEBHOOK_SECRET>",
 *       allowed_updates: ["message", "callback_query"],
 *       drop_pending_updates: true
 *     }
 *
 * Idempotent. Run again after a deploy if the public URL changes, or
 * after rotating the secret token. To clear the webhook, run
 * `npm run telegram:delete-webhook`.
 */

import { TelegramApiClient } from "../client.js";

interface SetWebhookPayload {
  readonly url: string;
  readonly secret_token: string;
  readonly allowed_updates: ReadonlyArray<string>;
  readonly drop_pending_updates: boolean;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    process.stderr.write(`missing required env var: ${name}\n`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const botToken = readEnv("TELEGRAM_BOT_TOKEN");
  const secretToken = readEnv("TELEGRAM_WEBHOOK_SECRET");
  const publicUrl = readEnv("ODON_PUBLIC_URL").replace(/\/$/, "");

  if (!publicUrl.startsWith("https://")) {
    process.stderr.write(`ODON_PUBLIC_URL must be HTTPS (got: ${publicUrl})\n`);
    process.exit(1);
  }

  const url = `${publicUrl}/webhook/telegram`;

  // Use the underlying fetch directly here rather than TelegramApiClient's
  // sendMessage helper; TelegramApiClient.call() is private. A bare fetch
  // is fine: this is a one-shot operational script, not a hot path.
  const apiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;
  const payload: SetWebhookPayload = {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  };

  process.stdout.write(`registering webhook: ${url}\n`);

  const response = await fetch(apiUrl, {
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

  if (!response.ok || (typeof body === "object" && body !== null && (body as { ok?: boolean }).ok === false)) {
    process.stderr.write(`setWebhook failed (HTTP ${response.status}):\n`);
    process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
    process.exit(1);
  }

  process.stdout.write(`ok\n`);
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);

  // Reference the client import so the build doesn't dead-code-eliminate
  // it. We're using TelegramApiClient indirectly via the fetch above;
  // this line keeps the import meaningful in case we add a typed wrapper.
  void TelegramApiClient;
}

main().catch((err: unknown) => {
  process.stderr.write(`set-webhook failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
