# Streaming STT Smoke Harness

This harness verifies the live streaming transcribers in a real browser, against
a real API, without depending on `examples/web`. One leg runs per invocation,
because each spends a different key.

Covered paths:

- `@charivo/stt/openai-realtime` → WebRTC session with an OpenAI
  `type: "transcription"` realtime session (`gpt-realtime-whisper`)
- `@charivo/stt/gemini-live` → Live API websocket session
  (`gemini-3.5-transcribe-live`) under manual VAD
- both → `@charivo/stt` (`STTManager`) → `@charivo/core` events
  (`stt:partial`, `stt:stop`, `stt:error`)

Run them explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_STREAMING_STT=1 OPENAI_API_KEY=your-key pnpm test:streaming-stt
RUN_LIVE_STREAMING_STT=1 GEMINI_API_KEY=your-key pnpm test:streaming-stt:gemini
```

Both legs reuse the realtime voice fixture
([../webrtc-smoke/fixtures/voice-smoke-input.wav](../webrtc-smoke/fixtures/voice-smoke-input.wav))
as canned speech fed into Chromium's fake microphone, so the suite runs without
local setup. Each leg skips cleanly if the fixture is missing, if
`RUN_LIVE_STREAMING_STT` or its own key is unset, or if `STREAMING_STT` selected
the other leg.

What the OpenAI leg proves:

- transcript deltas stream over the WebRTC data channel and reach the app as
  `stt:partial` **before** any `input_audio_buffer.commit` is sent — the design
  was validated on a WebSocket spike, so this is the first check on the
  transport that actually ships
- each `stt:partial` is a cumulative snapshot (every one extends its
  predecessor), not an isolated fragment
- the single commit sent at `stop()` resolves with a non-empty authoritative
  final transcript that loosely matches the fixture speech

What the Gemini leg proves:

- interims reach the app as `stt:partial` **before** `stop()` closes the
  activity, so a UI has something to render while the user is still speaking
- what `stt:stop` carries is exactly what the last `stt:partial` already showed,
  trimmed — the convergence property that lets a UI render partials without
  redrawing at stop

Both legs prove the `onPartial` → `stt:partial` bridge in `STTManagerImpl`
relays drafts into the core event system.

Why this suite loops the fixture (and the sibling suites do not): the WAV starts
playing the moment the transcriber opens the microphone, while session setup
takes seconds — for OpenAI, roughly 1.3–2.1s of secret mint, SDP exchange, ICE,
and data channel; for Gemini, a token mint plus the websocket handshake and
`setupComplete`. Played once, the fixture's speech could be over before media
flows — that produced an empty transcript in about one run in six. This config
therefore drops `%noloop` so the fixture repeats and speech is always available
whenever setup finishes. For the same reason each spec starts its fixed record
window only once the harness reports capture is live, rather than when `start()`
returned: measured from `start()`, the window is spent on that bring-up instead
of on audio, and a recording the server heard no speech in yields no transcript
at all.

That is safe **here** but not in the server-VAD suites. The `%noloop` requirement
in [../webrtc-smoke/fixtures/README.md](../webrtc-smoke/fixtures/README.md)
exists so the trailing silence can trigger OpenAI's server VAD before the file
loops. Neither session here runs server VAD: the OpenAI one sets
`turn_detection: null` and is ended by the single commit the transcriber sends at
`stop()`, and the Gemini one disables `automaticActivityDetection` so the
client's own `activityEnd` is the only boundary the recording has. Do not
"restore" `%noloop` here.

Consequence: the transcript contains repeated and/or partial sentences (for
example `"and smile for me. Please say hi and smile for me."`). The assertions
tolerate that on purpose — the OpenAI transcript check requires only the
distinctive token `smile`, never the full sentence, a sentence count, or a
length, and the Gemini assertions never inspect what was said at all.

The harness intentionally provides its own bootstrap routes: no key-bearing
helper ships with either transcriber, so the app owns the credentials. Each
route implements the consumer side of `bootstrap` exactly as the package docs
describe it. `/api/realtime-transcription` mints an ephemeral OpenAI secret
(`POST /v1/realtime/client_secrets`, `type: "transcription"`,
`turn_detection: null`) and trades the offer for an answer
(`POST /v1/realtime/calls`). `/api/stt-gemini-live` mints a single-use ephemeral
token (`POST /v1beta/auth_tokens`) whose `bidiGenerateContentSetup` pins the
model and manual VAD, and hands back the websocket url it is good for.

What it does not prove:

- microphone or transcription quality — the OpenAI final assertion is a loose
  token match rather than string equality, and the Gemini leg compares its final
  to its own last partial without reading either
- strict prefix monotonicity of the partials: asserted for the OpenAI leg only.
  The Gemini server revises its snapshot, so a shorter partial can follow a
  longer one, and the transcriber emits it as given
- how the audio was segmented. The harness snapshot records partials, the final,
  and how many partials preceded the stop — never turn boundaries. That the
  constrained Gemini token really holds the manual-VAD setting (rather than the
  server re-segmenting the recording on its own) was measured during the research
  behind `@charivo/stt/gemini-live`; nothing here observes it
- error, reconnect, or cancel-while-connecting paths (unit tests cover those)
- `examples/web` app behavior

Cost note, describing what a run costs rather than anything the spec asserts:
each run streams roughly five seconds of audio through one live session. The
OpenAI leg opens one realtime transcription session; the Gemini leg mints one
ephemeral token and opens one `gemini-3.5-transcribe-live` websocket session.
That model has no RPM limit on the demo (AI Studio) key, and its TPM limit is
consumed by audio duration, so this suite needs no quota-driven serialization or
backoff.
