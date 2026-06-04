# Realtime Baseline (Phase 0)

Recorded: 2026-05-29

Engineering baseline for the realtime stack. This is the anchor future changes
are compared against — not a user guide (it is intentionally outside the
published docs site). Keep it compact. Re-record the numbers when the stack or
fixture changes, and note the date.

Closes the Phase 0 exit criteria in [ROADMAP.md](../ROADMAP.md): response-start
latency is recorded, and interruption-recovery / lip-sync expectations are
stated explicitly enough to compare against.

## Response-start latency

**Definition.** Response-start latency = `realtime:session:start` (T0) →
`realtime:assistant:start` (T1), measured in the browser by the live voice
smoke specs feeding a canned WAV through Chromium's fake mic.

**What the raw delta includes** (see the header comment in
[realtime-voice-baseline.spec.ts](../tests/webrtc-smoke/realtime-voice-baseline.spec.ts)):

- session→mic-playback drift (~100–300ms, variable, left in the number — the
  mic-start boundary is not exposed at the event layer)
- a known fixed cost of 3000ms = 500ms leading silence + 2000ms speech + 500ms
  server VAD silence threshold
- network + model (the part we actually care about)

The spec also logs `raw − known fixed cost` as a coarse floor. It still carries
the drift above, so treat it as a trend/variance signal, **not** an absolute
post-VAD latency.

**Observed (2026-05-29, local, single run each):**

| Spec | Raw T0→T1 | Note |
|---|---|---|
| `realtime-voice-baseline.spec.ts` (tool-free) | ~2834ms | `raw − fixed` ≈ −166ms (approximate; drift/overlap makes it go slightly negative) |
| `realtime-voice-e2e.spec.ts` (avatar tools) | ~2707ms | includes tool-selection overhead |

**Update (2026-06-04).** The fake-mic WAV now **loops** (the `%noloop` suffix was
removed from `playwright.voice.config.ts`): the realtime session can take >2.5s to
go active, and the fixture's speech is at ~0.6–2.5s, so a single play let the
speech finish before audio reached the server — server VAD never heard a turn and
no response came (the smoke timed out). Looping guarantees a speech window lands
after the session is active. Side effect: the raw delta now carries "wait for the
next loop's speech" jitter, so it reads a touch higher. Fresh single runs after
the fix: baseline ~3690ms, e2e ~2523ms. Treat the raw number as a trend, and the
`raw − fixed cost` subtraction below as even rougher under looping.

**Anchor.** On the canned fixture, expect raw session-start→assistant-start in
the **~2.5–3.5s** band locally. Single runs are nondeterministic — re-run a few
times and compare the trend, not one number. The specs only *assert*
`deltaMs < 20000` (a smoke guard, not a performance target); a real regression
shows up as the trend drifting out of the band, not as the assertion failing.

**Re-measure:**
`RUN_LIVE_REALTIME_TESTS=1 RUN_LIVE_VOICE=1 OPENAI_API_KEY=your-key pnpm test:voice`
(the specs skip without the key; read the `[voice baseline]` / `[voice e2e]`
log lines from the output). If your key lives in a local shell file, sourcing it
first instead of inlining the key works too.

## Interruption recovery

Two ways an in-flight response gets interrupted; both must end cleanly and never
resume the old response.

**User-initiated** —
[`RealtimeManager.interrupt()`](../packages/realtime/src/realtime-manager.ts):
clears the outstanding-response flag, sets `response.status = "interrupted"`
(preserving the partial text), ends audio output, and emits state. In the demo
this is the red Stop button in `ChatInput`, shown while the turn status is
`responding`; the in-flight draft moves to an "Interrupted" bubble.

**Reconnect-driven** — on transport loss while responding (`beginReconnect`):
audio output ends and `response.status` is set to `"interrupted"` keeping the
partial text. The in-flight response is **not** resumed across the reconnect
(documented in [packages/realtime/README.md](../packages/realtime/README.md);
the demo derives its UI from `status === "interrupted"`).

**Expectation.** After either interruption: audio stops promptly, the partial
text is preserved and labelled interrupted, the old response is not resumed, and
the next fresh user turn clears the interrupted state and starts clean. The
existing test `keeps interrupted response state through reconnect and resets on
the next fresh turn` in
[realtime-core.test.ts](../packages/realtime/__tests__/realtime-core.test.ts)
locks this contract.

## Lip-sync

RMS-driven mouth movement: an analyzer reads the playing audio via Web Audio,
computes a normalized RMS, and feeds it to the renderer, which drives the Live2D
mouth-open parameter.

**Two analyzer paths:**

- TTS playback — [render/src/lipsync.ts](../packages/render/src/lipsync.ts):
  speech-band RMS, normalized `min(rms * 2, 1.0)`. Wired in
  `RenderManager.setEventBus` via `tts:audio:start` / `tts:audio:end` /
  `tts:lipsync:update`.
- Realtime voice —
  [openai-agents/lip-sync-analyzer.ts](../packages/realtime/src/openai-agents/lip-sync-analyzer.ts):
  RMS normalized `min(rms * 3, 1)`.

The Live2D renderer additionally amplifies the live RMS by `1.8` for visible
mouth movement on web audio
([lappmodel.ts](../packages/render-live2d/src/cubism/lappmodel.ts)), applied
after other model updates so the realtime/TTS signal takes priority over the
WAV-handler path.

**Expectation.** The mouth tracks audio loudness while audio plays and returns
to closed (RMS → 0) on audio end. The realtime/TTS RMS path overrides the
motion-file WAV lip-sync while active.

Lip-sync quality (timing tightness, naturalness) is not numerically benchmarked
here — these are the wiring and amplitude expectations a regression would break.
