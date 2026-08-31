# Gemini Live Spike Harness

A measurement device for the questions that decide whether a Gemini Live
transport is worth building, and in what shape. It answers them **before** the
transport exists, so it deliberately imports nothing from charivo — raw
WebSocket plus Web Audio and nothing else.

Background: `.hyperclaude/research/20260829-0612-gemini-live-api-charivo-realtime.md`
and its `-claude.md` pair.

Unlike the other harnesses here, this one is **driven by hand, not by
Playwright**. That is not laziness: the question it exists for is acoustic echo,
and `playwright.webrtc.config.ts` runs Chromium with
`--use-fake-device-for-media-stream` and `--mute-audio`. A fake microphone and a
muted output have no speaker, no room, and no acoustic path, so echo cannot
happen there at all — let alone be measured.

## Run it

```bash
GEMINI_API_KEY=your-key \
  pnpm exec vite --config tests/gemini-live-smoke/vite.config.ts
```

Then open the printed URL in a real browser. Test **Chrome and Safari on
macOS**, and **with speakers, not headphones** — headphones remove the acoustic
path, so every configuration passes and the run tells you nothing.

The key stays server-side: the vite middleware mints a single-use ephemeral
token and the page connects to the `BidiGenerateContentConstrained` endpoint
with `?access_token=`.

## What the probes already established

Verified against the live API on 2026-08-29, so the questions below are what is
actually left rather than the full original list.

**The research's `liveConnectConstraints` field does not exist.** Both
`v1alpha` and `v1beta` reject it with `400 Unknown name
"liveConnectConstraints" … Cannot find field`. The real field is
**`bidiGenerateContentSetup`**.

**It replaces the setup frame rather than validating it.** A token pinning only
`{ model }` produced a session that closed with `1007 The requested combination
of response modalities (TEXT) is not supported by the model` — the unspecified
rest of the setup fell back to defaults instead of merging with what the client
sent. So the mint route has to build the entire session config, which is why
voice and system instruction are posted to `/api/gemini-token` and the page's
own setup frame carries nothing but the model.

**The unconstrained-token threat is real.** A token minted with no
`bidiGenerateContentSetup` at all opened a session for a model the page never
offered. That is the shape the research warns about (P5), just under a
different field name.

**`uses: 1` is enforced.** Replaying a spent token closes the socket with
`1011 Token has been used too many times`, so a reconnect must re-mint rather
than reuse a cached bootstrap.

**Q4 is answered.** `gemini-3.1-flash-live-preview` accepts both
`inputAudioTranscription` and `outputAudioTranscription`, and output
transcription arrives as incremental events — ten of them for a ten-word reply.
Korean holds without any `languageCode`: asked to count, it returned
`하나, 둘, 셋, 넷, 다섯. 다 셌어요.` Downstream audio is `audio/pcm;rate=24000`
as documented. This unblocks R5, which depends on output transcription being
the assistant-text source.

**Q3 has a surprise worth knowing before you build the scheduler.** The server
streams audio far faster than real time and then *holds* `turnComplete` until
the wall-clock moment that audio would have finished playing:

| run | first audio | audio delivered | generationComplete | turnComplete | firstAudio + duration |
| --- | --- | --- | --- | --- | --- |
| 1 | +1439 ms | 10.560 s | +4346 ms | +12005 ms | +11999 ms |
| 2 | +1450 ms | 5.121 s | +2751 ms | +6543 ms | +6571 ms |

`turnComplete` lands within ~30 ms of "first chunk plus the duration of the
audio", and a browser run confirmed it against real playback: `turnComplete`
at +12034 ms, the last buffer's `onended` at +12037 ms. **Three milliseconds.**

That closeness is the trap. `turnComplete` is such a good predictor on a
healthy connection that a shortcut built on it passes every test you are
likely to run, and only fails when the network stalls — because the server is
pacing a clock, not observing your speakers.

**Both halves of R4's condition are load-bearing, and the same browser run
proves it.** Playback drains spuriously at the *start* of every turn:

```
07:28:35.081 first audio chunk of turn
07:28:35.084 playback drained BEFORE turnComplete — server still sending
07:28:35.141 first audio chunk of turn
```

The opening chunk is short enough to finish before its successor arrives, so
the scheduler empties and an "audio ended" fires 3 ms into a twelve-second
reply. Drain alone is therefore just as wrong as `turnComplete` alone — one
fires far too early, the other would be silently wrong exactly when it
mattered. `audio.output.ended` must be **drain AND `turnComplete` seen**, with
the corollary that if drain already happened when `turnComplete` lands, the
event fires then rather than waiting for a drain that will never come again.

Also seen unprompted: `sessionResumptionUpdate` arrives without being requested
in setup, and it arrives *constantly* — roughly every 1.2 s, ~50 handles over a
100 s session, each superseding the last. A transport that persists or logs
every one will drown; keep only the newest. Top-level keys observed so far are
`setupComplete`, `serverContent`, `sessionResumptionUpdate`, `usageMetadata`.

`usageMetadata` breaks tokens down per modality
(`promptTokensDetails` / `responseTokensDetails`, `TEXT` vs `AUDIO`), and the
audio prompt count grows turn over turn (259 → 596 across two turns) — the
input audio stays in context, which is what makes
`contextWindowCompression` matter for long sessions.

**Q1 passes on Chrome, with a live control to prove it.** Per the Media Capture
spec, `echoCancellation: true` only guarantees `remote-only` cancellation —
audio from an `RTCPeerConnection` track — and Web Audio output is not remote,
so on paper the WS path had no guarantee. Measured on Chrome / macOS, speakers
on, tester silent for a 30 s reply:

| `echoCancellation` | playback route | `interrupted` while silent |
| --- | --- | --- |
| `false` (control) | `direct` | **14** |
| `true` | `direct` | **0** |

The control is what makes the zero mean anything. With cancellation off the
model heard its own voice, took it for barge-in fourteen times, and garbled its
own counting as it repeatedly interrupted itself — the acoustic path was
demonstrably live. Turning cancellation on silenced it completely.

So Chrome's software AEC does cover `AudioWorklet` output in 2026, not just in
the 2018 blog post, and **the loopback trick is not needed for echo on
Chrome**. See "Design consequences" below for what that changes.

**Safari leaks echo for the first half-second of speech, then converges.**
Same protocol, Safari / macOS. The control climbed, so the path was live there
too. With cancellation on, interruptions did occur — but never at a random
time:

```
07:44:43.602 sent text: 1부터 50까지 천천히 세어줘.
07:44:44.262 first audio chunk of turn
07:44:44.804 interrupted #1 at 15.3s into session, 0.5s after the voice started
07:44:44.896 turnComplete                       <- turn killed, 58 response tokens
07:44:46.232 first audio chunk of turn
07:44:46.772 interrupted #2 at 17.3s into session, 0.5s after the voice started
07:44:46.828 turnComplete                       <- killed again, 72 tokens
07:44:49.365 first audio chunk of turn
07:44:56.709 turnComplete                       <- ran to completion, 190 tokens
```

The run deliberately waited ten seconds between connecting and sending, which
is what makes it conclusive: both interruptions ignore that offset and land
**0.5 s after the voice starts**, twice, to the tenth. They are tied to the
character speaking, not to session start and not to the click that sent the
message. That is an echo canceller adapting — Safari's needs roughly half a
second of the new signal to converge, and until it does, the model hears
itself and treats it as barge-in.

It converges *cumulatively*, not per turn: the third attempt survived seven
seconds of speech untouched, having banked ~1 s of adaptation across the two
turns it had already killed. The earlier Safari runs fit the same rule — a
single interruption ~1.2 s into a session where the tester clicked Send
immediately, which is again ~0.5 s after the voice began.

**Loopback does not fix it** (interruption at 1.1 s, statistically identical to
`direct`'s 1.3 s). Safari evidently does use the Web Audio output as its
reference, exactly as Chrome does; what costs time is the convergence itself,
and routing through an `RTCPeerConnection` does not make an adaptive filter
adapt faster.

### Q2 — What does a client-side `interrupt()` actually cost?

The Live API documents no client message that cancels an in-flight generation;
interruption is server-VAD driven. Press **interrupt() — local flush** while
the model is speaking; the `bytes discarded` counter then holds everything the
server kept producing for a turn nobody will hear, and the window closes at
`turnComplete`. Given that the server front-loads audio faster than real time,
expect this number to be large.

## Design consequences

Chrome's result retires the research's R2, which argued for making the WebRTC
loopback the default because the spec gave no guarantee. The guarantee is still
absent, but the behaviour is now measured rather than assumed, so the plain
`AudioWorklet → destination` path stands on Chrome.

That reopens one thing R2 had bundled away. Loopback would have handed lip sync
a `MediaStream` for free, letting `LipSyncAnalyzer.attachMediaStream()` work
unchanged. Without it, the answer is **not** `attachAudioNode()` — cross-context
`AudioNode`s cannot connect, so that signature drags the analyser's whole
`AudioContext` lifecycle in with it. Use R3's alternative instead: tap the
playback graph with a `MediaStreamAudioDestinationNode` alongside the audible
connection and hand `.stream` to the existing `attachMediaStream()`. No core
change, no peer connection, one extra node.

Safari's result retires loopback for the second time and for a better reason:
it was the designated fallback, and it does not work. Nothing in the transport
should carry a peer-connection playback path.

What Safari needs instead is a **convergence gate — hold mic frames back for
roughly the first 700 ms after the character's voice becomes audible.** During
that window the only thing the microphone reliably contains is the character's
own voice arriving before the canceller has adapted, so sending it buys
nothing and costs the turn. Three things make this safe to reason about rather
than a heuristic papering over a signal:

- The window is anchored to a fact the client owns — playback start — not to a
  guess about what the audio contains.
- Its cost is bounded and known: a barge-in inside the first 700 ms of a reply
  is dropped. The alternative is the character killing its own turn, twice,
  which is what the log above shows.
- It should decay. Convergence is cumulative across a session, so the gate can
  apply to the first turns and stop once a turn has survived intact.

Measure before shipping it: the 700 ms comes from one machine, one room, one
pair of speakers. The harness prints the exact offset for every interruption,
so widen or narrow it from data rather than from this paragraph.

## Known simplifications

- Downsampling is box-average decimation in the capture worklet, not a proper
  anti-alias filter. Fine for a spike; revisit if transcription quality looks
  worse than the model deserves.
- Capture runs at the device rate and playback at a forced 24 kHz, so there are
  two `AudioContext`s. The research flags two contexts as fragile on iOS; this
  harness targets desktop first.
- No tools are registered. Adding one dummy `functionDeclarations` entry would
  also confirm the `toolCall` → `{ id, name, response }` mapping, but that is a
  cycle-1 concern, not a gate.

## What it does not prove

- Anything about charivo's own interfaces — it implements none of them.
- Reconnection, `sessionResumption`, `goAway` handover, or context-window
  compression.
- iOS or Android behaviour.

## Afterwards

This directory is not throwaway. Once the transport exists, `src/main.ts` gets
replaced by one that drives the real client, `*.spec.ts` files land beside it,
and the vite config and token route stay as they are — at which point this
becomes the Gemini counterpart to `tests/webrtc-smoke/`.
