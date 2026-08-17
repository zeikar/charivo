---
"@charivo/core": minor
"@charivo/llm": minor
"@charivo/tts": patch
"@charivo/stt": patch
"@charivo/realtime": patch
"@charivo/server": patch
---

Real request cancellation for the cascade path, and a public `charivo.interrupt()`.

**@charivo/core (minor)**

- `LLMClient.call` and `callWithTools` take an optional trailing
  `LLMCallOptions { signal?: AbortSignal }`. Existing implementations keep
  working unchanged — a `call(messages)` implementation still satisfies the
  contract, and a client may ignore the signal.
- `GenerateResponseOptions.signal` carries that signal through a manager;
  `isCancelled` still only gates new work between steps.
- Latest-wins supersession now aborts the superseded turn's in-flight LLM
  request through a per-turn `AbortController`. A client that honors the
  signal stops waiting on the provider; one that ignores it settles late and
  the stale check swallows the settlement. The superseded `userSay` still
  resolves.
- New `charivo.interrupt()`: the cascade counterpart of
  `RealtimeManager.interrupt()`. Cuts off the in-progress turn (LLM request
  aborted, `turn:cancelled` emitted) and stops the exact TTS manager the turn
  is speaking on — mid-turn `attachTTS()` is accounted for. No precondition:
  when idle it still stops the attached TTS manager, resolves, and emits
  nothing. It does not delegate in realtime mode; use
  `getRealtimeManager()?.interrupt()` there. `turn:cancelled` now has two
  causes (supersession or `interrupt()`); its payload is unchanged.
- New export `fetchWithTimeout` (with `DEFAULT_FETCH_TIMEOUT_MS` and
  `FetchWithTimeoutOptions`): the shared fetch wrapper with an internal
  timeout, optional external `AbortSignal` (first-wins abort-source
  classification — an external abort is rethrown as-is, never misreported as
  a timeout), and a `mapError` hook.

**@charivo/llm (minor)**

- `LLMManager.generateResponse` forwards `options.signal` to the client, and
  the tool loop passes the same signal to every `callWithTools` round.
- The remote client threads the signal into its fetch, so aborting cancels
  the underlying HTTP request; the rejection is the abort reason, not a
  timeout error.

**@charivo/tts (patch)**

- `stop()` now also cancels a `speak()` still starting up (the pre-speech
  stop, or audio synthesis): that call resolves silently and never begins
  playback, whether or not it had already opened an audio session. A newer
  `speak()` cancels a still-starting older one the same way, and in-flight
  player stops are serialized so a late-settling stop can never tear down
  newer playback. Previously a stop landing in the startup window found
  nothing to stop and the pending `speak()` went on to start audio.

**@charivo/stt, @charivo/realtime, @charivo/server (patch)**

- Internal refactor: the per-package fetch-timeout helpers were replaced by
  core's shared `fetchWithTimeout`. No behavior change — messages, timeout
  values, and error mapping are preserved.
