// Gemini function-calling orchestrator.
// Strict rule: function-calling mode only, never free-form chat. The LLM proposes
// function calls against a typed schema; the dispatcher in this folder enforces
// permissions and filters tool outputs before they ever round-trip to the model.
export {};
