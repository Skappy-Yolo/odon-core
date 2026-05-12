---
name: security-check
description: Run a checklist of security-related checks on the current branch before merging or releasing. Surfaces dependency vulnerabilities, secrets in committed files, and basic prompt-injection patterns in any prompts.
---

Run the following checks and report findings as a single summary at the end:

1. `npm audit --audit-level=high` — fail if any high or critical vulns. Report each finding with the package, severity, and the suggested fix.

2. `npx --yes secretlint "**/*"` — scan for accidentally committed secrets. If `secretlint` is not installed, fall back to scanning for the patterns `sk_live_`, `BEGIN PRIVATE KEY`, `AIza` (Google API key prefix), `xoxb-` (Slack), and `gh[pousr]_` (GitHub tokens) using Grep.

3. Grep `src/llm/` for any string that concatenates user input directly into a prompt template. Specifically, look for patterns like `` `...${userMessage}...` `` or string interpolation that includes a variable named like `message`, `content`, `user`, `body`. Any hit needs human review. Report with file:line.

4. Grep across the repo for `calendar.events` (the broader write scope). Every occurrence must be inside the `/autoadd` opt-in flow path. Anything outside is a violation of the security model.

5. Confirm `.env` is in `.gitignore`. Confirm `.env` is NOT present in `git status`.

6. Check that every adapter implements webhook signature verification before doing other work. Grep `src/adapters/*/webhook.ts` for `verify` or `hmac`. Flag adapters that have a webhook handler but no signature verification call before the main logic.

Report findings as:
- PASS items (briefly listed)
- FAIL items (with file:line and a one-line description of what to fix)

Do not run any destructive commands. Do not auto-fix findings. The skill reports; the human (or a follow-up task) fixes.
