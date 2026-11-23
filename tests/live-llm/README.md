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
alone runs half the suite. That is also how you keep a run off a paid account —
naming only `GEMINI_API_KEY` exercises Gemini and never calls OpenAI:

```bash
RUN_LIVE_LLM_TESTS=1 GEMINI_API_KEY=your-key pnpm test:live-llm
```

What this suite validates, per provider (`@charivo/llm/openai`,
`@charivo/llm/gemini`):

- a plain chat turn returns text
- an empty tool registry leaves the `tools` parameter out, which the vendors
  reject when sent as `[]` — the SDK-mocked unit tests cannot prove this
- the avatar tool round trip: the model calls `setExpression` with an ID from
  the catalog, and the history is resent exactly as `LLMManager` resends it
  (assistant tool calls, then one tool result per call) until the model
  speaks. On Gemini this is the thought-signature placeholder path.

- the stage-direction probe that sets the documented `directionRole` for
  typed brain input (`@charivo/llm`, `LLMManagerOptions.directionRole`): a
  prompt ending in a direction sent as `system` and as `user`, built by
  `LLMManager` with the shipped prefix and system-prompt explanation, and
  whether a mid-history `system` message is read in place. The tallies are logged, not
  asserted (five repetitions each).

Recorded result (OpenAI `gpt-5.6-luna` on 2026-11-24, Gemini
`gemini-3.5-flash-lite` on 2026-11-23):

| Probe | OpenAI | Gemini (OpenAI-compatible endpoint) |
| --- | --- | --- |
| Trailing direction as `system` | followed 5/5 | rejected 5/5 (`400 Requests ending with a model turn are not supported`) |
| Trailing direction as `user` | followed 5/5 | followed 5/5 |
| Mid-history `system` position | in place 5/5 | hoisted 5/5 |

Gemini folds every `system` message into its system instruction, so a
direction there loses its place and a cue cannot end the prompt. Use
`directionRole: "user"` with Gemini; OpenAI works with the default `"system"`.

What it does not validate:

- `@charivo/llm/remote` or the `examples/web` routes
- the LLM manager's own tool loop, projectors, or history pruning
- TTS, STT, or anything in a browser

For the full browser chain (STT → LLM → TTS → lip-sync, through the remote
clients and server routes) use `tests/cascade-smoke/`, which can also run its
LLM leg on Gemini with `CASCADE_LLM=gemini`.

Cost note: per provider, four to six live calls — one plain chat completion,
one empty-tools completion, and two to four for the tool round trip — plus
fifteen for the stage-direction probe. Run only the probe with
`-t "mid-history"`, or only the rest with `-t "LLM provider"`.

The OpenAI leg runs the provider default (override with
`LIVE_OPENAI_LLM_MODEL`).
