# Live LLM Provider Tests

Node-level contract checks for the server-side LLM providers, one provider at a
time, against the real vendor APIs. They live at the repo root because they
compare providers from `@charivo/llm` against each other, not one package in
isolation.

Run them explicitly:

```bash
RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=your-key GEMINI_API_KEY=your-key pnpm test:live-llm
```

Each provider's block skips on its own when its key is missing, so either key
alone runs half the suite.

What this suite validates, per provider (`@charivo/llm/openai`,
`@charivo/llm/gemini`):

- a plain chat turn returns text
- an empty tool registry leaves the `tools` parameter out, which the vendors
  reject when sent as `[]` — the SDK-mocked unit tests cannot prove this
- the avatar tool round trip: the model calls `setExpression` with an ID from
  the catalog, and the history is resent exactly as `LLMManager` resends it
  (assistant tool calls, then one tool result per call) until the model
  speaks. On Gemini this is the thought-signature placeholder path.

What it does not validate:

- `@charivo/llm/remote` or the `examples/web` routes
- the LLM manager's own tool loop, projectors, or history pruning
- TTS, STT, or anything in a browser

For the full browser chain (STT → LLM → TTS → lip-sync, through the remote
clients and server routes) use `tests/cascade-smoke/`, which can also run its
LLM leg on Gemini with `CASCADE_LLM=gemini`.

Cost note: per provider, four to six live calls — one plain chat completion,
one empty-tools completion, and two to four for the tool round trip.
