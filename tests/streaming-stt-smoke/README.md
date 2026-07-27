# Streaming STT (WebRTC) Smoke Harness

This harness verifies the live streaming transcriber
(`@charivo/stt/openai-realtime`) in a real browser, over a real WebRTC
connection to the OpenAI Realtime API, without depending on `examples/web`.

Covered path:

- `@charivo/stt/openai-realtime` → WebRTC session with an OpenAI
  `type: "transcription"` realtime session (`gpt-realtime-whisper`)
- `@charivo/stt` (`STTManager`) → `@charivo/core` events
  (`stt:partial`, `stt:stop`, `stt:error`)

Run it explicitly:

```bash
pnpm exec playwright install chromium
RUN_LIVE_STREAMING_STT=1 OPENAI_API_KEY=your-key pnpm test:streaming-stt
```

It reuses the realtime voice fixture
([../webrtc-smoke/fixtures/voice-smoke-input.wav](../webrtc-smoke/fixtures/voice-smoke-input.wav))
as canned speech fed into Chromium's fake microphone, so the suite runs without
local setup. The spec skips cleanly if the fixture is missing or if
`RUN_LIVE_STREAMING_STT` / `OPENAI_API_KEY` are not set.

What it proves:

- transcript deltas stream over the WebRTC data channel and reach the app as
  `stt:partial` **before** any `input_audio_buffer.commit` is sent — the design
  was validated on a WebSocket spike, so this is the first check on the
  transport that actually ships
- each `stt:partial` is a cumulative snapshot (every one extends its
  predecessor), not an isolated fragment
- the single commit sent at `stop()` resolves with a non-empty authoritative
  final transcript that loosely matches the fixture speech
- the `onPartial` → `stt:partial` bridge in `STTManagerImpl` relays drafts into
  the core event system

Why this suite loops the fixture (and the sibling suites do not): the WAV starts
playing the moment the transcriber opens the microphone, while session setup
(secret mint + SDP exchange + ICE + data channel) takes roughly 1.3–2.1s. Played
once, the fixture's speech could be over before media flows — that produced an
empty transcript in about one run in six. This config therefore drops `%noloop`
so the fixture repeats and speech is always available whenever setup finishes.

That is safe **here** but not in the server-VAD suites. The `%noloop` requirement
in [../webrtc-smoke/fixtures/README.md](../webrtc-smoke/fixtures/README.md)
exists so the trailing silence can trigger OpenAI's server VAD before the file
loops. This session runs with `turn_detection: null`: there is no server VAD, and
the utterance is ended by the single commit the transcriber sends at `stop()`.
Do not "restore" `%noloop` here.

Consequence: the transcript contains repeated and/or partial sentences (for
example `"and smile for me. Please say hi and smile for me."`). The assertions
tolerate that on purpose — the transcript check requires only the distinctive
token `smile`, never the full sentence, a sentence count, or a length.

The harness intentionally provides its own `/api/realtime-transcription`
bootstrap route: no key-bearing helper ships with the transcriber, so the app
owns the credentials and the SDP exchange. The route mints an ephemeral secret
(`POST /v1/realtime/client_secrets`, `type: "transcription"`,
`turn_detection: null`) and trades the offer for an answer
(`POST /v1/realtime/calls`), which is exactly what the package docs tell
consumers to do.

What it does not prove:

- microphone or transcription quality (the final assertion is a loose token
  match, not string equality)
- server-VAD segmentation — the session runs with `turn_detection: null`, so
  the stop commit is the only commit
- error, reconnect, or cancel-while-connecting paths (unit tests cover those)
- `examples/web` app behavior

Cost note: each run opens one live OpenAI realtime transcription session and
streams roughly five seconds of audio through it.
