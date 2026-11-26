# Charivo VTuber

An autonomous AI VTuber built on Charivo's public API. It runs a scripted
ten-minute show on its own: a Live2D character (Haru) opens the stream, talks
through topics, answers a mock viewer chat, reacts to scripted game events,
fills quiet moments, and says goodbye. A Director panel next to the stage shows
every decision the show makes.

The point is the part Charivo deliberately does not do: **deciding when to
speak**. Charivo gives the character a voice, a face and a conversation, and
[leaves scheduling to the app](../../docs/guide/architecture.md#what-charivo-does-not-do).
This example is one way to build that layer, and it records what the missing
core primitives cost, and how the brain/body split answered each (see
[Findings](#findings-non-user-input)).

It is local-only: there is no live demo, and the scripts bind to
`127.0.0.1`.

## What it is and is not

It is a worked example of:

- a Director that decides what the character says next from four inputs (viewer
  chat, external agent events, an idle timer, and a segment schedule)
- a priority queue with pacing, cooldowns, and interrupts in front of a
  conversation brain: every line is one typed `brain.submit(...)` turn
- a cascade stack (Gemini chat through a server route, browser speech) driving a
  Live2D character, with `@charivo/avatar`'s
  [text-driven director](../../packages/avatar/README.md#text-driven-director)
  choosing its expression and motion from the spoken line

It is a minimum viable demo, not a product. Out of scope:

- real viewer chat (the chat is a mock: a text box plus scripted viewers)
- a real game agent, an A2A client, or commands sent to agents (the game events
  are a script)
- realtime voice (the cascade adapter is the only adapter)
- authentication, rate limiting, or deployment
- persistence: each Start begins an empty conversation
- changes to any `@charivo/*` package

## Run it

You need one key. Create `examples/vtuber/.env.local`:

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

Then, from the repository root:

```bash
pnpm install
pnpm build
pnpm --filter ./examples/vtuber dev
```

Open `http://127.0.0.1:3002`, wait for the stage to load, and press **Start**.
The Start click is also the user gesture the browser needs before it allows
speech.

**The chat route is unauthenticated.** `POST /api/chat` forwards to Gemini with
your `GEMINI_API_KEY` and checks only the shape of the request. That is why
`dev` and `start` pass `--hostname 127.0.0.1`: `next dev` and `next start`
listen on every interface by default, which would let anyone on your network
spend the key. Do not remove the flag or deploy this app as it is.

**The show spends the key unattended.** Once started it keeps making chat
requests, with nobody typing, until the ending segment finishes (at least ten
minutes) or you press **Stop**.

## The chat route

`POST /api/chat` uses `@charivo/server/gemini` with the model pinned in
`src/app/api/demo-limits.ts` (`gemini-3.5-flash-lite`). The browser reaches it
through the remote LLM client (the hook passes `apiEndpoint: "/api/chat"`). It
serves two callers: the talker, and the avatar classifier that picks an
expression and motion for each line. Neither sends tools. Its
limits are about the shape of a request, not its rate:

- a request carries at most 57 messages. The app pins `maxHistoryTurns` to 20
  (40 messages), and the route's cap is derived from the same constant plus
  the input sent on top of that window and headroom for tool messages, so a
  long show does not outgrow the route (Charivo's default of 40 turns would)
- per-message, total-size, tool-count, and tool-argument size caps bound what one
  request can make you pay for
- the model is chosen by the route, never by the request
- a reply is cut to 1,190 characters (at a sentence or word end), so a full
  history of replies still fits the request limits; the arithmetic is in
  `demo-limits.ts`
- a request must be `application/json` (else 415), and a browser request must
  come from `http://127.0.0.1:3002` or `http://localhost:3002` (else 403)
- there is no authentication, no rate limiting, and no request counting

## Pacing and quotas

Speech is the browser's Web Speech API (`@charivo/tts/web`), so it costs
nothing and has no quota. Voice quality and the available voices depend on the
browser and OS, and the example does not pick one: the browser's default voice
speaks. Lip sync is simulated from the text, because Web Speech gives no audio to
analyze. The Web Speech player gives each utterance a deadline (10 s plus 300 ms
per character at the default rate); if the browser never reports the end of an
utterance, the player cancels the speech and the line fails, so the next one can
start.

This is a change from an earlier design that used Gemini TTS. On the demo key,
Gemini TTS answered 429 with a free-tier limit of 10 requests per day for
`gemini-3.1-flash-tts`, measured 2026-11-22. A ten-minute show needs dozens of
lines, so the show could not run on that key. A paid key or another TTS provider
would be the upgrade.

The Director's pacing, set in `src/app/lib/show-plan.ts`:

- `idleAfterMs` (3,000 ms): how long the Director waits, with nothing to say,
  before it asks for an idle line
- `minLineIntervalMs` (9,000 ms): the least time between the starts of two lines
- `failedLineBackoffMs` (14,000 ms): the least time from a failed line's start to
  the next line

These shape the show. They are **not request limits**. A line makes two browser
requests to `/api/chat`: one from the talker and one from the avatar classifier.
Both count against the same key. The model's stated quota on this key is 15
requests per minute; the most browser requests to `/api/chat` seen in any 60 s
window was 12 (see [the 2026-11-23 run](#avatar-director-measured-2026-11-23)).
That is observed browser traffic, not proof that the limit holds: retries on the
provider side are invisible to the browser.

A failed line (a provider 429 or 503, which the route returns as a 500, or a
client timeout) is logged, counted, and skipped. It is
not retried, and the show continues on schedule.

## How it works

The code is three layers with an import rule, so the middle piece can be lifted
into another app:

| Layer | Path | May import |
| --- | --- | --- |
| Director (portable) | `src/director/` | its own files only (tests also `vitest`, `node:*`) |
| Charivo cascade adapter | `src/adapters/` | `@charivo/core` (types), `../director` |
| App | `src/app/` | Next.js, React, `@charivo/*`, both of the above |

`src/director/boundary.test.ts` enforces the Director's rule only; the other two
rows are convention. The Director uses the global
`setTimeout` and `Date.now` and nothing from the DOM, React, or Charivo.

**Two contracts**, both defined in `src/director/types.ts`:

- `CharacterPort`: `speak(input)` takes the line's typed input (`LineInput`, the
  shape of a brain input) and settles when the line is over, with a status of
  `"completed"`, `"cancelled"` or `"failed"`; `interrupt()` resolves once the
  audio has stopped and rejects if it could not be stopped.
- `ShowEventSource`: `start(emit)` and `stop()`. A source calls `emit(event)`
  whenever it has something. It carries no transport types.

**All four inputs are sources.** Two are passed in as `sources`, typed so they
can emit only `chat` and `agent` events: the chat box (`createPushSource()`) and
the scripted viewers emit chat, and the scripted game events emit agent events. Two are created
by the Director itself and emit internal events: the idle timer (`idle`, 3 s after
a drain finds nothing to say) and the segment scheduler (`segment`, at each
segment start). The Director starts every source on `start()` and stops each one
once when the show ends.

**The head and the body are split.** The talker, the cascade brain over
Charivo's LLM manager, has no tools and writes only the line. The avatar
director listens for `performance:start` (through
`connectAvatarDirectorToPerformances`), classifies the line with a second LLM
call in parallel with the speech, and emits `avatar:expression` and `avatar:motion`; a result that
arrives after its line is no longer current is dropped. If a classification
fails, the line still finishes and the avatar keeps its current state. The
classifier is a second remote LLM client to the same route, so its requests
share the talker's quota. Gaze is not an LLM decision: it follows the mouse
(`mouseTracking`). The hook logs each decision to the browser console with an
`[avatar]` prefix. The package side is described in the
[Text-Driven Director](../../packages/avatar/README.md#text-driven-director).

**"Speaking" is derived, not read.** The Director never reads Charivo events. It
is busy from calling `port.speak()` until that promise settles, and it starts a
line only when it is not busy. (The stage's status indicator is separate: it
shows "speaking" while TTS audio is active, between `tts:audio:start` and
`tts:audio:end`, and "thinking" while a line is in flight with no audio.) The
cascade adapter makes that true: a brain turn settles once its reply has been
spoken, cut or has failed, and `brain.submit(input).done` never rejects. The
adapter maps the turn's `BrainTurnResult` onto the port: `completed` and
`cancelled` carry over with the reply's text, `failed` (a generation, render
or TTS failure, or a reply that `review` withheld) is `"failed"` with the
error's message, and `silent` is also `"failed"`, because every line asks for
a reply (`respond: "must"` on events, the default on chat and cues). The
adapter is the only submitter, so a cancelled turn can only come from the
Director's own `interrupt()`, which is `brain.interrupt()`.

If `interrupt()` rejects, audio may still be playing, so the show ends as
`failed` and the adapter refuses every later line. The only recovery is a page
reload.

**The policy** (`src/director/policy.ts`, pure) ranks and filters events:

| Input | Priority | Ignored when | Expires |
| --- | --- | --- | --- |
| Ending cue | -1 (lowest) | never | no |
| Segment cue | 4 | never | no |
| Super chat, or `high` agent event | 3 | empty; queue full (a repeat viewer or source is not limited) | chat never; agent after 30 s |
| Chat, or `normal` agent event | 2 | empty; same viewer or source within 10 s; queue full | chat never; agent after 30 s |
| `low` agent event | 1 | as `normal` | after 30 s |
| Idle filler | 0 | anything is playing or waiting | n/a |

The queue holds at most five chats and three agent events. Equal priorities are
spoken in arrival order. A super chat or `high` event interrupts only idle
filler, and only if 15 s have passed since the last interrupt; otherwise it waits
in the queue. Queued chat is spoken by priority once the current line ends, so a
segment cue can still go first, and pacing applies. A segment start also
discards queued idle filler. The ending cue ranks last: once it is accepted, new
chat and agent events are ignored (`show-ending`), what was already queued is
spoken first, and the show finishes when the ending line settles.

**Typed inputs.** The brain takes three kinds of input, so no text has to carry
a tag and the character's prompt needs no protocol (`src/director/line-input.ts`
builds them):

- `{ kind: "user", speaker, text }`: a viewer said this; answer them. Kept in
  history.
- `{ kind: "direction", text }`: a private stage direction; act on it, never
  mention it. A direction defaults to ephemeral: it rides on the request that
  answers it and is never stored.
- `{ kind: "event", source, text, respond: "must" }`: something happened in the
  character's world; react to it in character. The brain would answer an event
  by default only when no turn is under way and the character is free, but the Director starts a line
  only when it should be spoken, so it asks for the reply.

Viewer names and text, and agent source names and text, are still flattened to
one line and length capped, because they come from outside the show. The route
is Gemini, which folds every system message into its system instruction, so
the app creates the LLM manager with `directionRole: "user"` and a direction
reaches the model as a user turn (see the [LLM guide](../../docs/guide/llm.md)).

**The cue-echo review.** The brain hands `review` the reply and a snapshot of
the request's `direction` entries before anything is shown or spoken
(`src/app/lib/reply-review.ts`). A reply that repeats a stage direction
verbatim (30 characters or more of it, ignoring case and spacing) makes
`review` throw, so the turn ends `failed` at `generate`, the line is reported
failed ("Reply withheld: it repeated a stage direction") and nothing is spoken.
A paraphrase of a cue is still spoken and can only be counted afterwards.

**A realtime adapter** would satisfy the same port without touching the
Director. `speak()` would send the prompt over the session and settle when the
response ends or is cancelled, and `interrupt()` would cancel the response. Not
built here.

## Architecture

### Mapping to a talker and skill agents

The module follows a simple model of an agent that appears to act on its own:

| Part | Here |
| --- | --- |
| Perception | the event sources |
| Reflex (cheap, immediate decisions) | `policy.ts`, which decides without calling a model |
| Conscious (deliberate, in character) | the cascade brain over Charivo's LLM |
| Action | `CharacterPort`, then the brain's `perform()` on the body, plus the avatar director (expression, motion) |

The talker is the character. Skill agents are separate processes that do work
the talker should not, such as playing a game. They exchange information with it
like this:

```text
skill agent --- events ---------------> Director --> brain (cascade + LLM) --> body (perform)
skill agent <-- commands (LLM tools) ----------------- brain
skill agent --- async results, as events --> Director
```

Two parts are **not built**: the command arrow (the talker delegating work to an
agent through LLM tools) and a real agent. The scripted game events stand in for
an agent's event arrow only.

### Where this could go

- **A2A.** An A2A adapter would be one more event source (agent messages in) plus
  tools (commands out). Nothing in the Director would change. Not built.
- **An event loop, not a graph workflow.** The Director reacts to events in
  continuous time and can be interrupted mid-line. A graph workflow models
  discrete steps, which fits inside a skill agent but not the show loop.
- **A single-writer assumption.** The Director assumes it is the only thing that
  starts turns. Companion's realtime voice breaks that, because a human starts
  turns there by speaking. Before Companion adopts the module, the port will need
  a way to report activity it did not start.

## Findings: non-user input

Before the brain/body split, Charivo's one way to give the character input
stored every input as a `user` message. A stage
direction or a game event therefore looked like something a viewer said, and
this example worked around it with an envelope of text tags
(`[CHAT]`, `[DIRECTOR]`, `[EVENT]`), a protocol in the system prompt and a
wrapper around the LLM client. The question was whether Charivo needed a core
primitive for non-user input. The three findings below were the answer's
inputs; each is now answered by the API the example runs on:

- **Cues and events were stored as `user` turns.** They counted against
  `maxHistoryTurns`, pushed real chat out of the window, and an interrupted
  cue stayed in history as a direction the model never finished. Answered by
  typed inputs: a `direction` is ephemeral and never stored, a viewer's `user`
  input keeps its place, and an unheard reply is taken back out of history.
- **There was no hook between the LLM reply and the speech.** The app had to
  wrap the LLM client to withhold a reply that repeated a cue. Answered by the
  brain's `review`: it sees the reply and the request's directions before
  anything is presented, and can replace the reply, drop it, or throw.
- **The app could not see a line's life.** It derived "speaking" from a settled
  input call and a handful of speech events. Answered by `performance:*` and
  `floor:changed`, plus the `BrainTurnResult` a turn settles with. This app
  uses `performance:start` for the caption and the avatar director.

What stays true is that a cue the model paraphrases is still spoken: `review`
catches a verbatim echo, not a paraphrase.

The automated tests cover sequencing and input typing against scripted
replies: one line at a time, nothing cut, the show reaches its ending, a
direction sits in the request as an ephemeral `direction` entry and is never
stored, and `review` withholds a verbatim echo. They do not show how a real
model handles cues, or anything about browser audio. Those need a live run.

The Director panel counts cue leaks on every spoken reply: a reply that
contains the word "director". A reply that repeats a cue verbatim never gets
that far: `review` withholds it, and it shows up as a failed line ("Reply
withheld: ..."). So the leak counter mostly catches the word "director". It
cannot catch a paraphrase, and it also flags an innocent "film director".
Every reply in the live runs is also read by hand for cue disclosure and for
treating a cue or event as a viewer's words.

### Results

Measured 2026-11-22 on the demo key, on the earlier envelope build (before the
brain; the typed-input build has not been re-run live), with the production build (`next start`) in
Chromium driven by Playwright on macOS. Speech used the default Web Speech voice
(Samantha, en-US). Nobody listened: "spoken" below means the browser reported
`speechSynthesis.speaking` for the line and the Director logged it completed.

**Run 1, no input (criterion 1).** Both scripted sources off, nothing touched
after Start.

- The show reached `finished` 631 s after Start. The ending cue was queued at
  600 s, waited for the idle line in flight, and started at 608 s.
- Segments ran in order: opening at 0 s, the three topics at 60, 240 and 420 s,
  the ending at 600 s.
- Lines spoken 24, cancelled 0, failed 0, ignored 0, cue leaks 0. Every segment
  had its cue line plus recurring idle lines (2, 5, 7 and 5 for the opening and
  the three topics), and the ending line was spoken.
- No two lines overlapped and none was cut. The longest stretch without speech
  while running was 31 s; a line usually took several seconds of "thinking"
  before speech. A later measurement of that tool-based build (2026-11-23, 11
  lines) found a median of about 3.55 s (2.5 to 4.2 s) from the talker request
  to the start of speech, with 2 to 3 chat requests per line at about 1.25 s
  each. The longer figure first reported here did not reproduce.
- Verdict: autonomy demonstrated, with the caveat above that it was observed
  through `speechSynthesis`, not heard.

**Run 2, scripted viewers and game events on (criteria 2 and 3).** Stopped by
hand at 371 s.

- Lines spoken 16, cancelled 2 (the cut idle line and the line in flight at
  Stop), failed 0, ignored 0, cue leaks 0.
- All six scripted viewer messages were answered. A chat sent while a line was
  playing was marked queued and answered after that line ended, behind two
  higher-priority items that were already waiting (a scripted super chat and a
  high-priority game event), as the priority order says.
- A super chat sent during idle filler cut it (logged cancelled, not failed) and
  was answered in the same second.
- Of four game events, two got reaction lines and two were dropped as stale
  after waiting past `agentMaxAgeMs` (30 s) behind chat. Events appeared only in
  the Director panel, never as viewer messages.

**Leak review.** Every spoken line of run 1 (24) and every Haru line in run 2's
transcript (run 2 recorded 16 lines spoken and 2 cancelled) were read: none contains a
tag, the word "director", or "stage direction", and none answers a cue or an
event as if a viewer had said it.

**Is a core non-user-input primitive warranted? Not yet.** On the cascade path
the envelope held: 0 leaks in run 1 (24 lines, driven only by cues) and in run 2's
transcript (16 lines spoken, 2 cancelled). What the workaround could not fix was
structural rather than behavioral: cues sat in history as `user` turns and used
up `maxHistoryTurns`, and an interrupted cue stayed there. Neither broke this
show, and typed inputs have since removed both. Revisit when the Director moves
to Companion's realtime path, where the provider owns the history and a person
speaks too, so a cue sent as `user` text cannot be told apart from them.

### Avatar director, measured 2026-11-23

After the avatar moved from LLM tools to the text-driven director. Production
build, headless Chromium with `fetch` and `speechSynthesis` instrumented, both
scripted sources on, `gemini-3.5-flash-lite`. Two runs, the second after one
prompt change. Both classified on the reply's first speech event; the trigger later moved to
the performance's start (emitted after the line is rendered, just before
speaking), and no run was repeated after that. "Selected" below means the event was
emitted on the bus; it is not confirmed playback, because the render manager can
still decline a selection at its catalog or debounce checks.

- **Latency.** From the talker request to the start of speech: median 1.29 s
  (1.04 to 1.75 s, 19 lines) in run 1 and 1.17 s (1.02 to 1.60 s, 18 lines) in
  run 2, against about 3.55 s for the tool build. Each line made exactly one
  talker request. The avatar expression was emitted a median of about 1 s after
  the utterance started.
- **Silence between lines.** Median about 4.1 s (run 2: 4.07 s; idle gaps 4.05
  to 4.55 s; lines already queued followed about 1 to 2 s after the previous one),
  against about 11.5 s for the tool build. This is a combined measurement: the
  builds differ in idle wait (8 s to 3 s), in the pacing floor, and in requests
  per line, and the runs did not isolate them. Most of the drop likely comes
  from the shorter idle wait. It is not a measure of the director alone; the
  request-to-speech latency above is the direct talker comparison.
- **Requests.** At most 12 `/api/chat` requests in any 60 s window, in both runs,
  beside the key's stated 15 per minute. This is observed browser traffic, not
  proof that the limit holds.
- **Live HTTP failures.** None in either run besides the one injected below, and
  no 429 in the server output. Avatar requests share the talker's quota, so a
  live 429 could still land on either.
- **Selections (run 2, 16 completed lines, opening line excluded).** An
  expression on 16 of 16 lines (F01 12, F02 2, F06 1, F08 1); a motion on 12 of
  16 (TapBody[0] 9, TapBody[1] 2, TapBody[2] 1); classifier failures 0 of 16. No
  expression read as wrong. Motions fit about 10 of 16 lines, and the main miss
  was an unwarranted TapBody[0] on a calm line.
- **The prompt change.** Run 1 picked a motion on 16 of 16 lines. The one change
  was telling the classifier that most lines need no motion; run 2 is after it.
- **Failure.** The test script answered the opening line's classifier request
  with a 500. The line still completed and the next line started as usual. No
  other failure case was exercised.

## Credits

The bundled Live2D model is the property of its creator and is included only to
demonstrate Charivo:

- **Haru**: Live2D sample model, © Live2D Inc., distributed under the
  [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html).
  Using it requires agreeing to the
  [per-model terms](https://docs.live2d.com/cubism-editor-manual/sample-model/).

No model ships in any published `@charivo/*` package. The Cubism SDK itself
carries separate terms; see
[`packages/render-live2d/LICENSE.md`](../../packages/render-live2d/LICENSE.md).
