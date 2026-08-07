---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/realtime": minor
"@charivo/stt": minor
---

Clean up the event contract ahead of 1.0. Four breaking changes, no back-compat aliases.

- The unnamespaced `error` event is now `llm:error`, consistent with `tts:error`
  / `stt:error` / `realtime:error`. It still has a single emitter: the
  `LLMManager` result-projector failure path. Payload is unchanged.
- `realtime:tool:call|result|error` are renamed to modality-neutral
  `tool:call|result|error`, and the `LLMManager` tool loop now emits them too —
  previously only realtime did, leaving the LLM tool path observably silent.
  Payloads are unchanged. `tool:result` from the LLM path carries the JSON
  snapshot of the handler result (the same value the model's tool turn
  receives), matching what realtime already emits, so the event means the same
  thing from both modalities. Note a deliberate divergence that this change does
  NOT close: LLM `resultProjectors` still receive the original validated handler
  result (so `Date`, `undefined`, and getter properties survive), while realtime
  projectors receive the snapshot. Projectors that must behave identically
  across both modalities should read only plain JSON values.
- `stt:partial` and `stt:stop` carry their transcript under `text` instead of
  `transcription`, aligning them with `tts:start` and the realtime transcript
  and delta events. The remote STT HTTP wire shape is a separate contract and
  still uses `{ transcription }`; `STTTranscriber.onPartial`'s callback
  parameter name is also unchanged.
- `realtime:text:delta` is removed. It was emitted back-to-back with
  `realtime:assistant:delta` carrying an identical `{ text }` payload; use
  `realtime:assistant:delta`.
