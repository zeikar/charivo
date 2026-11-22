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
core primitives cost (see [Findings](#findings-non-user-input)).

It is local-only: there is no live demo, and the scripts bind to
`127.0.0.1`.

## What it is and is not

It is a worked example of:

- a Director that decides what the character says next from four inputs (viewer
  chat, external agent events, an idle timer, and a segment schedule)
- a priority queue with pacing, cooldowns, and interrupts in front of
  `Charivo.userSay()`
- a cascade stack (Gemini chat through a server route, browser speech) driving a
  Live2D character with `@charivo/avatar` tools

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
through the remote LLM client (the hook passes `apiEndpoint: "/api/chat"`). Its
limits are about the shape of a request, not its rate:

- a request carries at most 56 messages. The app pins `maxHistoryTurns` to 20
  (40 messages), and the route's cap is derived from the same constant plus
  headroom for the tool loop, so a long show does not outgrow the route
  (Charivo's default of 40 turns would)
- per-message, total-size, tool-count, and tool-argument size caps bound what one
  request can make you pay for
- the model is chosen by the route, never by the request
- there is no authentication, no rate limiting, and no request counting

## Pacing and quotas

Speech is the browser's Web Speech API (`@charivo/tts/web`), so it costs
nothing and has no quota. Voice quality and the available voices depend on the
browser and OS, and the example does not pick one: the browser's default voice
speaks. Lip sync is simulated from the text, because Web Speech gives no audio to
analyze.

This is a change from an earlier design that used Gemini TTS. On the demo key,
Gemini TTS answered 429 with a free-tier limit of 10 requests per day for
`gemini-3.1-flash-tts`, measured 2026-11-22. A ten-minute show needs dozens of
lines, so the show could not run on that key. A paid key or another TTS provider
would be the upgrade.

The Director's pacing, set in `src/app/lib/show-plan.ts`:

- `minLineIntervalMs` (7,000 ms): the least time between the starts of two lines
- `failedLineBackoffMs` (14,000 ms): the least time from a failed line's start to
  the next line

These shape the show. They are **not request limits**: a line makes one to four
chat requests, because the avatar tool loop calls the model again after each
round of tool calls (at most three rounds). The chat model's request ceiling was
not measured.

A failed line (a provider 429 or 503, which the route returns as a 500, or a
client timeout) is logged, counted, and skipped. It is
not retried, and the show continues on schedule.

## How it works

The code is three layers with an import rule, so the middle piece can be lifted
into another app:

| Layer | Path | May import |
| --- | --- | --- |
| Director (portable) | `src/director/` | its own files only (tests also `vitest`, `node:*`) |
| Charivo cascade adapter | `src/adapters/` | `@charivo/core` (types and `getErrorMessage`), `../director` |
| App | `src/app/` | Next.js, React, `@charivo/*`, both of the above |

`src/director/boundary.test.ts` enforces the Director's rule only; the other two
rows are convention. The Director uses the global
`setTimeout` and `Date.now` and nothing from the DOM, React, or Charivo.

**Two contracts**, both defined in `src/director/types.ts`:

- `CharacterPort`: `speak(prompt)` settles when the line is over, with a status of
  `"completed"`, `"cancelled"` or `"failed"`; `interrupt()` resolves once the
  audio has stopped and rejects if it could not be stopped.
- `ShowEventSource`: `start(emit)` and `stop()`. A source calls `emit(event)`
  whenever it has something. It carries no transport types.

**All four inputs are sources.** Two are passed in as `sources`, typed so they
can emit only `chat` and `agent` events: the chat box (`createPushSource()`) and
the scripted viewers emit chat, and the scripted game events emit agent events. Two are created
by the Director itself and emit internal events: the idle timer (`idle`, 8 s after
a drain finds nothing to say) and the segment scheduler (`segment`, at each
segment start). The Director starts every source on `start()` and stops each one
once when the show ends.

**"Speaking" is derived, not read.** The Director never reads Charivo events. It
is busy from calling `port.speak()` until that promise settles, and it starts a
line only when it is not busy. (The stage's status indicator is separate: it
shows "speaking" while TTS audio is active, between `tts:audio:start` and
`tts:audio:end`, and "thinking" while a line is in flight with no audio.) The cascade adapter makes that true:
`Charivo.userSay()` awaits the TTS manager's `speak()`, which resolves when the
utterance finishes, so a settled `userSay()` is the end of playback. The adapter
classifies the outcome: `turn:cancelled` for its own turn is `"cancelled"`, a
`tts:error` or a rejected `userSay()` is `"failed"`, anything else is
`"completed"`. The adapter is the only caller of `userSay()`, so a cancelled turn
can only come from the Director's own `interrupt()`.

If `interrupt()` rejects, audio may still be playing, so the show ends as
`failed` and the adapter refuses every later line. The only recovery is a page
reload.

**The policy** (`src/director/policy.ts`, pure) ranks and filters events:

| Input | Priority | Ignored when | Expires |
| --- | --- | --- | --- |
| Ending cue | 5 (highest) | never | no |
| Segment cue | 4 | never | no |
| Super chat, or `high` agent event | 3 | empty; queue full (a repeat viewer or source is not limited) | chat never; agent after 30 s |
| Chat, or `normal` agent event | 2 | empty; same viewer or source within 10 s; queue full | chat never; agent after 30 s |
| `low` agent event | 1 | as `normal` | after 30 s |
| Idle filler | 0 | anything is playing or waiting | n/a |

The queue holds at most five chats and three agent events. Equal priorities are
spoken in arrival order. A super chat or `high` event interrupts only idle
filler, and only if 15 s have passed since the last interrupt; otherwise it waits
in the queue. Queued chat is spoken by priority once the current line ends, so a
segment or ending cue can still go first, and pacing applies. A segment start
also discards queued idle filler.

**The envelope.** Charivo's only input is `userSay()`, which stores everything as
a viewer message. So each input is tagged, and the character's system prompt
explains the tags (`SHOW_PROTOCOL_INSTRUCTIONS`, appended to
`Character.personality`):

- `[CHAT] <viewer>: <text>`: a viewer said this; answer them
- `[DIRECTOR] <text>`: a private stage direction; act on it, never mention it
- `[EVENT] <source>: <text>`: something happened in the character's world; react
  to it in character

Viewer names and text, and agent source names and text, are flattened to one line, length
capped, and have square brackets replaced, so none of them can forge a tag.

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
| Conscious (deliberate, in character) | Charivo's LLM |
| Action | `CharacterPort`, plus the avatar tools (expression, motion, gaze) |

The talker is the character. Skill agents are separate processes that do work
the talker should not, such as playing a game. They exchange information with it
like this:

```text
skill agent --- events --------------------> Director --> talker (Charivo + LLM)
skill agent <-- commands (LLM tools) --------------------- talker
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

Charivo's `userSay()` is the only way to give the character input, and it stores
every input as a `user` message. A stage direction or a game event therefore
looks like something a viewer said. This example works around it with the
envelope above and measures how well that holds. The question is whether Charivo
needs a core primitive for non-user input.

Known limits of the workaround, from reading the code:

- cues and events are stored as `user` turns in the conversation history
- they count against `maxHistoryTurns`, so they push real chat out of the window
- a cue that was interrupted stays in history, and the model sees a direction it
  never finished
- there is no hook to veto a reply before it is spoken, so a reply that reveals a
  cue is spoken anyway and can only be counted afterwards

The automated tests cover sequencing and envelope placement against scripted
replies: one line at a time, nothing cut, the show reaches its ending, and the
cue sits in the request as `[DIRECTOR] ...` with the protocol in the system
message. They do not show how a real model handles cues, or anything about
browser audio. Those need a live run.

The Director panel counts cue leaks on every spoken reply: a reply that contains
an envelope tag or the word "director". It cannot catch a paraphrase, and it also
flags an innocent "film director". Every reply in the live runs is also read by
hand for cue disclosure and for treating a cue or event as a viewer's words.

### Results

**Provisional.** The full-show live run and the verdict on whether a core
primitive is warranted are not recorded yet.

Early observations from browser runs on the demo key, 2026-11-22. They come from
short runs, not the full show, and prove little:

- a line took about 7 to 21 s of "thinking" before speech. That is Gemini chat
  latency over one to four chat requests through the avatar tool loop
- lines were spoken
- cue leaks counted 0
- a chat message was answered after the line that was playing
- a super chat cut idle filler; the cut line shows as cancelled, not failed

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
