# Gemini Live Smoke Harness

Package-level browser harness for the Gemini Live realtime chain, and the
measured record that decided that chain's shape.

Covered chain:

- `@charivo/core`
- `@charivo/avatar`
- `@charivo/realtime`
- `@charivo/realtime/remote`
- `@charivo/realtime/gemini`
- `@charivo/server/gemini`

It started as a spike that imported nothing from charivo — raw WebSocket plus
Web Audio — because the questions it had to answer came *before* the transport
existed. It now drives the real chain instead, but the answers stayed:
["The measured record"](#the-measured-record) is why the transport is built the
way it is, and most of it contradicts what the API reference implies. Read it
before changing the design back toward the documentation.

Background: `.hyperclaude/research/20260829-0612-gemini-live-api-charivo-realtime.md`
and its `-claude.md` pair.

## Run it

```bash
GEMINI_API_KEY=your-key \
  pnpm exec vite --config tests/gemini-live-smoke/vite.config.ts
```

Then open the printed URL in a real browser. Test **Chrome and Safari on
macOS**, and **with speakers, not headphones** — headphones remove the acoustic
path, so every configuration passes and the run tells you nothing.

Two harness modes, selected with a `?mode=` query param:

- `smoke` (default) — the named-expression catalog (`Smile`), `setExpression`
  as the only registered tool, and instructions that name the ID verbatim. The
  tool leg is deterministic on purpose, so a spec asserts a fixed round-trip
  rather than whatever the model felt like calling.
- `avatar-prompt-eval` — the opaque `F01`..`F08` catalog, all three canonical
  avatar tools, and the default `@charivo/realtime` instructions plus the
  `@charivo/avatar` addendum. Here what the model picks *is* the measurement.

Both catalogs live in [`tests/avatar-catalog.ts`](../avatar-catalog.ts), shared
with `tests/webrtc-smoke` so the two harnesses cannot drift into measuring
different things. The `expressionDescriptions` there are the only channel that
gives `F01`..`F08` any meaning, and they were established by rendering each
expression and reading the face — don't paraphrase them from a mapping found
on the web, which is wrong.

The key stays server-side. The vite middleware implements the same
`/api/realtime` bootstrap contract as `tests/webrtc-smoke`, delegating to
`createGeminiRealtimeProvider`; the browser gets a socket URL and a single-use
ephemeral token pinned to a session config it cannot exceed — the page proposes
a model, a voice, and instructions, and the provider decides what survives.
Model and voice allow-lists live in the provider, not in the route.

Keep the devtools console open. `src/main.ts` builds the remote client with
`debug: true`, and that log is the measuring instrument: it prints how long
after playback started each interruption landed, and when the convergence gate
disarmed.

## Why it is driven by hand

The question this harness exists for is acoustic echo, and
`playwright.webrtc.config.ts` runs Chromium with
`--use-fake-device-for-media-stream` and `--mute-audio`. A fake microphone and
a muted output have no speaker, no room, and no acoustic path, so echo cannot
happen there at all — let alone be measured. Every number below came from a
human sitting in front of speakers.

The gated Playwright suite beside this harness (`pnpm test:gemini-live`) covers
what a fake device can:

- `realtime-gemini-live.spec.ts` drives the default `smoke` mode: the session
  connects through the real bootstrap, a turn produces assistant text, and a
  real `setExpression` call round-trips into a canonical `avatar:expression`
  event carrying the ID the instructions named.
- `realtime-gemini-avatar-prompt.spec.ts` drives `avatar-prompt-eval`: it asks
  for anger and requires a displeased ID (`F03` / `F08`) back, failing on a
  smiling one. Nothing but `expressionDescriptions` can supply that, and on
  this path they travel through the minted `bidiGenerateContentSetup` —
  `systemInstruction` for the addendum, `tools.functionDeclarations.parameters`
  for the schema — which is where they could silently be dropped. It is an
  **advisory evaluation, not a CI gate**: model outputs are nondeterministic,
  so treat a failure as a signal to inspect the instructions or the prompt, not
  as a blocking regression.

Transcript ordering is **not** among them — `user.transcript` is emitted only
from spoken audio, and a fake device drives no speech, so an ordering assertion
there could never fail honestly. It stays in the manual protocol below. Like
the live specs in `tests/webrtc-smoke`, the suite is not free: each spec mints
an ephemeral token and opens its own real Gemini Live session, so a full run
costs two sessions and three model turns and repeated runs bill real usage.

## The manual protocol

### Chrome — the echo control

`echoCancellation: true` is what makes the WS playback path usable at all (see
the measured record). The control run that proved it — cancellation *off*, so
the acoustic path is demonstrably live — was a spike-only affordance and the
selector is gone. To re-run it, flip `echoCancellation` to `false` in
`DEFAULT_MICROPHONE_CONSTRAINTS`
(`packages/realtime/src/internal/microphone.ts`), take the reading, and put it
back. Without the control, a run of zero false interruptions means nothing: it
is equally consistent with a dead microphone.

Send `1부터 50까지 천천히 세어줘.`, then stay silent for the whole reply. Every
interruption in that window is a false one.

### Safari — re-tuning `CONVERGENCE_GATE_MS`

The gate holds microphone frames back for the first `CONVERGENCE_GATE_MS`
(`packages/realtime/src/gemini/defaults.ts`) after the character's voice becomes
audible, and disarms once the session has banked that much audible playback.
Both halves come from one machine, one room, one pair of speakers, so re-measure
before trusting them elsewhere:

1. Start the session, then **wait about ten seconds before sending anything.**
   That offset is what makes the reading conclusive: it separates "tied to the
   voice starting" from "tied to session start" or "tied to the click".
2. Send the counting prompt and stay silent.
3. Read the console. `Gemini Live turn interrupted <n>ms after playback started`
   is the number the window is tuned from; `Convergence gate disarmed after
   <n>ms of audible playback` is the number the exposure threshold is tuned
   from.

Interruptions still landing means the window is too short. Turns being killed
after the gate disarms means the threshold is.

### ANSWERED — Q2 and the tool frame, measured 2026-09-01

Two of the three questions this cycle deferred are now settled, headlessly,
through the gated Playwright suite plus two throwaway probe scripts against the
promoted harness. Neither needed a listener.

**Q2 — a killed turn does still run to its own `turnComplete`.** This is the
load-bearing premise of the condemned-turn design: `turnComplete` is the single
exit from condemnation, so if a killed turn never sent one the client would
stay condemned and swallow the *next* turn's completion, stranding the
manager's send lock. Measured: interrupting mid-count produced **no** completion
for the killed turn (`assistantCompletions` unchanged), the log showed
`Gemini Live turn condemned by a local interrupt`, and the very next prompt
completed normally, advancing the count by exactly one. It could not have done
that had the condemnation never lifted. The premise holds.

**The `toolCall` frame shape is confirmed, and a tool-using turn reports exactly
ONE completion.** The API-reference shape is right: `{ id, name, args }`
arrived, the `{ id, name, response }` answer was accepted, and the character
spoke a follow-up. The second half matters more. A tool-using turn was measured
producing **one** `assistant.response.completed` for the whole turn — the tool
leg does *not* emit a separate one. So the empty-text-completion skip that
`openai/client.ts` carries (its tool turns are measured to report twice) must
**not** be ported here: it would swallow the only completion the turn has and
strand the send lock. `handleTurnComplete` emits unconditionally on purpose.

**`expressionDescriptions` reaches the model and the model uses it.** Asked to
be angry over the opaque `F01`..`F08` catalog, it called `setExpression` with
`F03` — which the catalog alone defines as "angry". Nothing else on the wire
carries that meaning, so the channel survives `bidiGenerateContentSetup` intact.

### Live-run results, 2026-09-01 (Chrome and Safari, real speakers)

**Chrome, silent through a full reply: zero interruptions.** The AEC finding
from the spike holds through the real transport, not just the standalone
measurement page.

**The ending contract behaves as designed, and both orderings occurred.** One
run had `realtime:assistant:done` at +12.753 s with `tts:audio:end` at
+12.763 s — the drain landing 10 ms *after* `turnComplete`. Another had
`tts:audio:end` at +27.888 s and `assistant:done` at +27.895 s — the drain
first, with the ending fired from the `turnComplete` idle branch. Both produced
exactly one audio start/end pair. Those are the two main rows of the ending
matrix, observed live on real hardware. Also visible: the last text delta at
+5.799 s against a `turnComplete` at +12.753 s, i.e. the server holding
`turnComplete` for the audio's duration exactly as the timing table records.

**Input transcription is finalized per utterance, and it arrives in order.** A
long multi-clause Korean sentence produced **one** `realtime:user:transcript`
carrying the whole sentence, at +11.372 s, with the assistant turn it prompted
starting at +11.953 s. Both stop-and-redesign conditions passed, so the
no-accumulation-buffer mapping stands.

**Safari: no self-interruption across a multi-turn session.** The spike had
Safari killing its own turns ~0.5 s after each voice onset; with the
convergence gate in the transport, a ~44 s session with three replies produced
no `interrupted` event at all. The `Convergence gate disarmed after <n>ms`
console line was not captured on that run, so whether the gate disarmed or
simply stayed armed through short turns is unknown — either is correct
behaviour, and nothing observed argues for moving `CONVERGENCE_GATE_MS` off its
spike-measured value. Re-measure before trusting it on other hardware.

One thing that is *not* a defect, in case it is seen again: a lone
`realtime:user:transcript` can appear shortly after a turn ends (one run
transcribed a stray `s` 1.1 s after `tts:audio:end`). That is the microphone
picking up the room and server VAD opening a new turn — no `interrupted` fires
and nothing is cut off, because the previous turn had already completed.

### OPEN — still needs a human at the machine

**The AEC control run.** Every Chrome result above is a zero, and a zero only
means something against a run where the counter climbs. The control —
`echoCancellation: false` in `DEFAULT_MICROPHONE_CONSTRAINTS`
(`packages/realtime/src/internal/microphone.ts`), take the reading, put it back
— has been done for the spike's standalone page but not yet through the real
transport. Until it is, the Chrome zeros are consistent with a live acoustic
path *and* with a microphone that is not being heard at all.

## The measured record

Verified against the live API on 2026-08-29 unless marked otherwise. Anything
labelled **documented** comes from the API reference and has *not* been seen on
the wire.

### The token contract

**The research's `liveConnectConstraints` field does not exist.** Both
`v1alpha` and `v1beta` reject it with `400 Unknown name
"liveConnectConstraints" … Cannot find field`. The real field is
**`bidiGenerateContentSetup`**.

**It replaces the setup frame rather than validating it.** A token pinning only
`{ model }` produced a session that closed with `1007 The requested combination
of response modalities (TEXT) is not supported by the model` — the unspecified
rest of the setup fell back to defaults instead of merging with what the client
sent. So the whole session config has to be built at mint time, which is why
the server provider owns it and the browser's setup frame carries nothing the
token did not already fix.

**The unconstrained-token threat is real.** A token minted with no
`bidiGenerateContentSetup` at all opened a session for a model the page never
offered — any model, any config, on the key owner's bill.

**`uses: 1` is enforced.** Replaying a spent token closes the socket with
`1011 Token has been used too many times`, so a reconnect must re-mint rather
than reuse a cached bootstrap.

### End of playback

The server streams audio far faster than real time and then *holds*
`turnComplete` until the wall-clock moment that audio would have finished
playing:

| run | first audio | audio delivered | generationComplete | turnComplete | firstAudio + duration |
| --- | --- | --- | --- | --- | --- |
| 1 | +1439 ms | 10.560 s | +4346 ms | +12005 ms | +11999 ms |
| 2 | +1450 ms | 5.121 s | +2751 ms | +6543 ms | +6571 ms |

`turnComplete` lands within ~30 ms of "first chunk plus the duration of the
audio", and a browser run confirmed it against real playback: `turnComplete`
at +12034 ms, the last buffer's `onended` at +12037 ms. **Three milliseconds.**

That closeness is the trap. `turnComplete` is such a good predictor on a
healthy connection that a shortcut built on it passes every test you are likely
to run, and only fails when the network stalls — because the server is pacing a
clock, not observing your speakers.

**Drain alone is just as wrong, and the same run proves it.** Playback drains
spuriously at the *start* of every turn:

```
07:28:35.081 first audio chunk of turn
07:28:35.084 playback drained BEFORE turnComplete — server still sending
07:28:35.141 first audio chunk of turn
```

The opening chunk is short enough to finish before its successor arrives, so
the scheduler empties and an "audio ended" fires 3 ms into a twelve-second
reply. `audio.output.ended` therefore has to be **drain AND `turnComplete`
seen**, with the corollary that if drain already happened when `turnComplete`
lands, the event fires then rather than waiting for a drain that will never
come again.

### Transcription and session frames

`gemini-3.1-flash-live-preview` accepts both `inputAudioTranscription` and
`outputAudioTranscription`. Output transcription arrives as incremental
fragments — ten events for a ten-word reply, and 44 fragments in a session where
two spoken utterances produced exactly two complete-sentence *input*
transcription events. Korean holds without any `languageCode`: asked to count,
it returned `하나, 둘, 셋, 넷, 다섯. 다 셌어요.` Downstream audio is
`audio/pcm;rate=24000`, as documented.

`sessionResumptionUpdate` arrives without being requested in setup, and it
arrives *constantly* — roughly every 1.2 s, ~50 handles over a 100 s session,
each superseding the last. A transport that persists or logs every one will
drown. Top-level keys observed: `setupComplete`, `serverContent`,
`sessionResumptionUpdate`, `usageMetadata` — and, since 2026-09-01, `toolCall` (see
[ANSWERED](#answered--q2-and-the-tool-frame-measured-2026-09-01) above).
`toolCallCancellation` and `goAway` are **documented** only.

`usageMetadata` breaks tokens down per modality (`promptTokensDetails` /
`responseTokensDetails`, `TEXT` vs `AUDIO`), and the audio prompt count grows
turn over turn (259 → 596 across two turns) — the input audio stays in context,
which is what makes `contextWindowCompression` matter for long sessions.

### Echo, Chrome

Per the Media Capture spec, `echoCancellation: true` only guarantees
`remote-only` cancellation — audio from an `RTCPeerConnection` track — and Web
Audio output is not remote, so on paper the WS path had no guarantee. Measured
on Chrome / macOS, speakers on, tester silent for a 30 s reply:

| `echoCancellation` | playback route | `interrupted` while silent |
| --- | --- | --- |
| `false` (control) | direct | **14** |
| `true` | direct | **0** |

The control is what makes the zero mean anything. With cancellation off the
model heard its own voice, took it for barge-in fourteen times, and garbled its
own counting as it repeatedly interrupted itself. Turning cancellation on
silenced it completely. Chrome's software AEC does cover `AudioWorklet` output,
so the plain worklet → destination path stands and no loopback is needed.

### Echo, Safari

Same protocol, Safari / macOS. The control climbed there too. With cancellation
on, interruptions did occur — but never at a random time:

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

The run deliberately waited ten seconds between connecting and sending, which is
what makes it conclusive: both interruptions ignore that offset and land **0.5 s
after the voice starts**, twice, to the tenth. They are tied to the character
speaking, not to session start and not to the click that sent the message. That
is an echo canceller adapting.

It converges *cumulatively*, not per turn: the third attempt survived seven
seconds of speech untouched, having banked ~1 s of adaptation across the two
turns it had already killed. That is where both halves of `CONVERGENCE_GATE_MS`
come from — the ~0.5 s window and the ~1 s cumulative exposure threshold.

**Loopback does not fix it** (interruption at 1.1 s, statistically identical to
direct playback's 1.3 s). Safari evidently uses the Web Audio output as its
reference exactly as Chrome does; what costs time is the convergence itself, and
routing through an `RTCPeerConnection` does not make an adaptive filter adapt
faster. Loopback was the designated fallback and it was measured not to work,
which is why nothing in the transport carries a peer-connection playback path —
and why the harness no longer offers one to compare against.

## Design consequences

Two follow-ons from the echo results that the transport's own comments cite
back to.

**Lip sync gets a tap, not a node.** Loopback would have handed
`LipSyncAnalyzer.attachMediaStream()` a `MediaStream` for free; with it retired,
the answer is *not* an `attachAudioNode()` — the analyzer owns its own
`AudioContext` and `AudioNode`s cannot connect across contexts, so that
signature would drag the analyzer's whole context lifecycle into the transport.
A `MediaStreamAudioDestinationNode` alongside the audible connection costs one
node and leaves the existing `attachMediaStream()` untouched.

**That leaves the client holding several `AudioContext`s** — playback forced to
24 kHz, capture at the device rate, and the analyzer's own. The research flags
even two as fragile on iOS. These checks are desktop-first.

## What it does not prove

- Reconnection, `sessionResumption`, `goAway` handover, or context-window
  compression.
- iOS or Android behaviour.
- Output audio quality, microphone UX, or rendering behaviour.
- The `examples/web` route. `tests/live-realtime/` covers its OpenAI branch
  live; the Gemini branch has only the route's unit tests
  (`examples/web/src/app/api/realtime/route.test.ts`).
