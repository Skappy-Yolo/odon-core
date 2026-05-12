/**
 * One-shot script that clears the bot's webhook with Telegram.
 *
 * Usage:
 *   npm run telegram:delete-webhook
 *
 * Reads TELEGRAM_BOT_TOKEN.
 *
 * Use when:
 *   - you're rotating the secret token
 *   - you're moving the bot to a different public URL
 *   - you're shutting odon-core down and don't want Telegram retrying
 */

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

  const apiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: true }),
  });

  const body = (await response.json().catch(() => undefined)) as { ok?: boolean } | undefined;

  if (!response.ok || body?.ok === false) {
    process.stderr.write(`deleteWebhook failed (HTTP ${response.status}): ${JSON.stringify(body)}\n`);
    process.exit(1);
  }

  process.stdout.write(`webhook cleared\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`delete-webhook failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
