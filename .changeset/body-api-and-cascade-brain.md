---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/avatar": minor
"@charivo/render": minor
---

Charivo is now the body and the conversation brain is an adapter. See `docs/history/brain-body-migration.md` for the before/after of every change below.

**Body API on `Charivo`** (`@charivo/core`): `perform({ text, origin?, whenBusy?, affect? })` speaks a string or a text stream on one floor and returns a `PerformanceHandle` (`started`, `done` with `heardText`, `result`, `cancel()`). Streams are cut at sentence ends, and each segment is announced with the new `performance:segment` event. `react()` shows a non-verbal reaction without taking the floor; its handle releases only its own claims, and `critical` (reflex only) also cancels the line on the floor. `getFloor()` and the new `floor:changed` event report `idle`, `speaking` or `realtime`, and `setAffectMap()` maps semantic affect labels to the model's expressions and motions. `performance:start` gains `text` and `affectResolved`; `performance:end` gains `heardText` and `error`. A failed TTS stop is remembered: no other voice starts until that manager confirms a stop.

**Brain port**: `ConversationBrain`, `BrainTurn` and `BrainTurnResult`, with `attachBrain()`, `detachBrain()`, `getBrain()` and the `brain` option on `createCharivo`.

**Cascade brain** (`@charivo/llm`): `createCascadeBrain(llm, { review? })` runs the LLM turn on top of the body: latest-wins submission, history in call order, rollback of replies nobody heard, the `respond` (`must` / `auto` / `silent`) and `history` (`keep` / `ephemeral` / `replaceKey`) policies of typed inputs, a `review` hook between the reply and speech, and tool-chosen expressions shown with the line. `LLMManager` gains `GenerateResponseOptions.interceptProjection` and `standalone` history entries, which pruning never treats as replies that lost their prompt.

**Avatar** (`@charivo/avatar`): `connectAvatarDirectorToPerformances(bus, director)` drives the text-driven avatar director from performance events, and `director.say(text, { performanceId })` ties the inferred expression to that performance.

**Render** (`@charivo/render`): claims and `avatar:release` may carry a `claimId`; a release that names one ends only the claim accepted with that id.

**Breaking changes**

- `userSay()`, `attachLLM()`, `detachLLM()`, `getLLMManager()`, `clearHistory()`, `getHistory()` and the `llm` option are removed from `Charivo`. Use `createCharivo({ brain: createCascadeBrain(llm) })` and `charivo.getBrain()`.
- The `character:speak`, `tts:start`, `tts:end` and `tts:error` events are removed. Use `performance:start` / `performance:end`.
- `turn:cancelled` now carries `{ turnId }` instead of `{ userMessageId }`.
- `charivo.interrupt()` now stops speech only; cancel a turn that is still generating with `turn.cancel()` or `brain.interrupt()`.
- User messages are no longer rendered; read them from `message:sent`.
- `connectAvatarDirectorToCascade` is removed; use `connectAvatarDirectorToPerformances`.
- `attachRealtime()` throws while a performance holds the floor or cancelled speech has not been confirmed stopped, and `perform()` throws while realtime is attached.
- `dispose()` now rejects with a `CharivoDisposeError` (`CHARIVO_DISPOSE_ERROR`) for every failure, with the original error as `cause`; a typed `CharivoError` no longer passes through with its own code.
- `perform()` and `attachRealtime()` throw `CharivoStateError` from a `dispose()` call until its teardown is done, and overlapping `dispose()` calls share one promise.
