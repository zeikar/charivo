---
"@charivo/core": minor
"@charivo/llm": minor
---

`userSay()` is now latest-wins: calling it again while a turn is still in
flight supersedes that turn instead of racing it. The superseded call's
promise still resolves — it just stops short of any further turn-scoped
effect or event — and a new `turn:cancelled { userMessageId }` event fires
for it exactly once, supersession being its only cause. Its user message is
retained and lands in history ahead of the superseding turn's own message,
regardless of which phase the supersession landed in; from there it is
subject to the usual `maxHistoryTurns` eviction like any other message. Any
reply the superseded turn was generating is dropped — a reply now only
commits to history at the presentation boundary, after its character
render and before playback, so a superseded turn never gets that far.
`message:sent` also moved earlier, into the turn's entry block ahead of the
pre-turn TTS stop, and message ids are now collision-free within an
instance. Message validation and empty-assistant-reply handling are
unchanged.

Making this safe required two additions to the `LLMManager` contract:
synchronous `addToHistory(message): HistoryRollback`, and a
`GenerateResponseOptions` second argument to `generateResponse` with
`callerOwnsHistory` (the manager performs no history writes for that call)
and `isCancelled` (stops new tool work and gates every projected emission
once it starts returning `true`). `addToHistory` is presence-idempotent by
reference identity, rejects invalid messages with a typed `CharivoStateError`,
and returns a handle that removes what it appended and restores what that
call evicted, as long as nothing else has written since.

Both are now **required** members of `LLMManager`, which only matters if you
implement that interface yourself — the public API is factory-only
(`createLLMManager`), so most consumers are unaffected. A custom manager
needs to add `addToHistory` and accept the new `generateResponse` options to
keep satisfying the interface.

`@charivo/llm`'s built-in manager implements both: `addToHistory` backs the
direct-use path too, which now rolls back by reference identity instead of
a positional `removeLast()`, and its eviction is orphan-safe — scoped to
what a given write actually evicted, rather than trimming blindly.
