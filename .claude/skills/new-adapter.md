---
name: new-adapter
description: Scaffold a new rail adapter (telegram, whatsapp, discord, openclaw, etc.) implementing the odon-core adapter contract. Creates the directory, the contract implementation stub, the webhook handler skeleton, and an adapter-specific README.
---

When invoked with an adapter name (e.g. `discord`, `whatsapp`, `openclaw`):

1. Create `src/adapters/<name>/` with the following files:
   - `index.ts` — exports the adapter class
   - `adapter.ts` — implements the `Adapter` interface from `src/core/contract.ts`
   - `webhook.ts` — incoming-request handler with HMAC verification stub
   - `README.md` — adapter-specific docs (auth model, deployment notes, links to platform docs)

2. The adapter class must:
   - Implement every method on the `Adapter` interface, even if as `throw new Error("not implemented")`.
   - Verify incoming webhook signatures before doing any work. Do not skip this step in the scaffold.
   - Never log raw tokens, signing secrets, or PII.

3. The webhook handler must:
   - Validate the HMAC signature first, drop unverified requests with 401.
   - Normalize incoming events into the `IncomingMessage` shape from the contract.
   - Pass the normalized event to the orchestrator via the engine HTTP API.

4. Update `src/adapters/index.ts` to export the new adapter.

5. Append a build-log entry: "Added `<name>` adapter scaffold. Contract implemented as stubs."

Hard rules that apply to every adapter:
- Function-calling-mode-only on the LLM. No free-form chat. Adapters never bypass this.
- `calendar.freebusy` is the default OAuth scope. Adapters never request more without the explicit `/autoadd on` flow.
- Audit log writes happen in the engine, not the adapter.

Refer to `src/adapters/telegram/` as the reference implementation if it exists.
