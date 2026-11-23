# @charivo/avatar

Avatar control for Charivo, in two modes: catalog-constrained tools the model
calls, or a text-driven director that reads the spoken line.

`@charivo/avatar` depends only on `@charivo/core`. The tool-calling mode builds
`setExpression`, `playMotion`, and `lookAt` tool definitions/handlers from your
model's expression and motion catalog, plus a matching instruction string and a
result projector that turns successful tool calls into `avatar:*` events.

Pair `createAvatarControlTools(...)` with `buildAvatarControlInstructions(...)`
when you want the model to use avatar actions proactively. Keep those
instructions in the app/session layer rather than in `@charivo/llm` or
`@charivo/realtime` so non-avatar sessions in those packages stay generic.

The other mode, the [text-driven director](#text-driven-director), leaves the
talking model with text only and makes a separate classifier call per line.

## Install

```bash
pnpm add @charivo/avatar
```

## Exports

- `createAvatarControlTools(catalog)`
- `buildAvatarControlInstructions(catalog)`
- `createAvatarResultProjector()`
- `AVATAR_CONTROL_TOOL_NAMES`
- `SET_EXPRESSION_TOOL_NAME`
- `PLAY_MOTION_TOOL_NAME`
- `LOOK_AT_TOOL_NAME`
- `type ExpressionArgs`, `type MotionArgs`, `type LookAtArgs`
- `createAvatarDirector(options)`
- `connectAvatarDirectorToCascade(bus, director)`
- `createLLMAvatarClassifier(client)`
- `type AvatarDirector`, `type AvatarDirectorOptions`, `type AvatarClassifier`,
  `type AvatarDecision`

`createAvatarControlTools(catalog)` returns `ToolRegistration[]` from
`@charivo/core`, so it works with both `LLMManager` (`@charivo/llm`) and
`RealtimeManager` (`@charivo/realtime`) tool registries. `setExpression` and
`playMotion` are included only when `catalog.expressions` /
`catalog.motions` are non-empty; `lookAt` is always included.

## Usage With `RealtimeManager`

```ts
import { createRealtimeManager } from "@charivo/realtime";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

const catalog = {
  expressions: ["Smile", "Sad"],
  motions: { Idle: 2, TapBody: 3 },
  expressionDescriptions: { Smile: "happy or amused", Sad: "downcast or disappointed" },
  motionDescriptions: { Idle: ["resting", "shifting weight"], TapBody: ["waves", "folds her arms"] },
};

const manager = createRealtimeManager(client, {
  tools: createAvatarControlTools(catalog),
  resultProjectors: [createAvatarResultProjector()],
});

await manager.startSession({
  provider: "openai",
  instructions: buildAvatarControlInstructions(catalog),
});
```

## Usage With `LLMManager`

```ts
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

const catalog = { expressions: ["Smile", "Sad"], motions: { Idle: 2, TapBody: 3 } };

const manager = createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" }), {
  tools: createAvatarControlTools(catalog),
  resultProjectors: [createAvatarResultProjector()],
  toolInstructions: buildAvatarControlInstructions(catalog),
});
```

`LLMManager` only runs the tool loop when the underlying `LLMClient` also
implements `callWithTools` (e.g. `@charivo/llm/remote` talking to a route that
forwards tools to `generateResponseWithTools`). See the
[LLM package README](../llm/README.md#tool-calling) for the remote request/response
shape and the round cap.

## Text-Driven Director

The director is the alternative to tool calling. The talking LLM writes only
text. The director reads each spoken line, makes one small classifier call per
line (no history), checks the decision against the catalog, and emits
`avatar:expression` and `avatar:motion`. It does not emit gaze.

It drives only the body, not what the character says. An app that also decides
when the character talks (like the vtuber example's show "Director") has a
separate component for that.

```ts
import {
  connectAvatarDirectorToCascade,
  createAvatarDirector,
  createLLMAvatarClassifier,
} from "@charivo/avatar";

const director = createAvatarDirector({
  catalog,
  classifier: createLLMAvatarClassifier(llmClient), // any LLMClient
  emitter: charivo,
  onError: (error) => console.error(error), // defaults to console.warn
});

const disconnect = connectAvatarDirectorToCascade(charivo, director);
```

`createAvatarDirector(options)` returns an `AvatarDirector`:

- `say(text)` classifies one complete line.
- `push(chunk)` then `done()` build a line from streaming text; the first
  `push()` after a line ends starts a new one.
- `cancel()` ends the line and drops the open buffer and any pending decision.

Only the cascade wiring ships. `push()` / `done()` exist for streaming text
sources, such as an adapter you write.

### Line Lifecycle

`connectAvatarDirectorToCascade(bus, director)` returns a disconnect function.
It sends each `character:speak` to `say()` and treats `tts:audio:end`,
`tts:end`, `tts:error`, and `turn:cancelled` as the end of the line, calling
`cancel()`. It ignores a `character:speak` whose turn was already cancelled.

- A pending decision is stale, and its signal aborted, when a new line begins
  (`say()` or the first `push()`) or on `cancel()`. Currency is rechecked before
  each emission, so a stale decision emits nothing.
- Each field of a decision is checked against the catalog separately. An id or
  motion the catalog does not have is dropped silently, and the other field
  still emits, so a valid expression plays beside an invalid motion.
- A classifier that rejects or throws emits nothing and goes to `onError`, or
  `console.warn` without it. A failure from a superseded or cancelled line is
  not reported.
- `say()`, `push()`, `done()`, and `cancel()` never throw.

Two cases emit none of the four line-over events: a text-only turn (no TTS
manager attached) and a turn that fails after `character:speak` but before TTS
starts, such as a renderer failure. Call `director.cancel()` yourself there if a
late decision should be dropped; otherwise it applies when ready, and the next
line supersedes it.

### Classifier

An `AvatarClassifier` is
`({ text, catalog, signal }) => Promise<AvatarDecision>`, where
`AvatarDecision` is `{ expressionId?, motion?: { group, index } }`. Anything
that returns one works, so a rule-based or local classifier is just another
function:

```ts
import type { AvatarClassifier } from "@charivo/avatar";

const keywordClassifier: AvatarClassifier = async ({ text, catalog }) =>
  /thank|great|haha/i.test(text) && catalog.expressions.includes("Smile")
    ? { expressionId: "Smile" }
    : {};
```

`createLLMAvatarClassifier(client)` uses `LLMClient.call()` with two messages:
a system message listing every expression id and motion group index range
(groups with zero clips are left out), with the catalog descriptions as hints,
and the line as the user message. It passes
the director's `signal` and parses the first JSON object in the reply.

### Cost

The director adds one extra LLM request per line, with no conversation history.
The tool loop instead adds a round trip for each round of tool calls.

## Events

The director emits `avatar:expression` — `{ expressionId }` and
`avatar:motion` — `{ group, index, muteSound: true }` (muted for the same reason
as tool-call motions), and never `avatar:gaze`.

`createAvatarResultProjector()` emits, on successful tool execution:

- `avatar:expression` — `{ expressionId }`
- `avatar:motion` — `{ group, index, muteSound: true }` — the result projector
  asks for muting because the motion came from a tool call, so a sample clip
  baked into the motion does not talk over the character's own voice
- `avatar:gaze` — `{ x, y }`

`@charivo/render`'s `RenderManager` already listens for these three events, so
wiring a `RenderManager` picks them up automatically.

## Instruction Composition

`buildAvatarControlInstructions(catalog)` returns generic, catalog-aware
guidance (it adjusts wording based on which of expressions/motions are
available). If your app needs stronger product-specific acting guidance,
append it at the app layer instead of expanding this package's default text:

```ts
const instructions = [
  buildAvatarControlInstructions(catalog),
  "Keep replies short and natural for this product.",
].join("\n");
```

## Expression And Motion Descriptions

`catalog.expressionDescriptions` is an optional `Record<string, string>` of
expression IDs to short meanings. Keys are expression IDs from
`catalog.expressions`; keys that don't match are ignored. When present,
matching meanings are appended to the `setExpression` tool's `expressionId`
parameter description and to `buildAvatarControlInstructions(...)` output.

`catalog.motionDescriptions` does the same for motions, as an optional
`Record<string, string[]>`. Keys are group names from `catalog.motions`, and
each array is positional — index 0 describes motion index 0 — because
`playMotion` takes a group AND an index, and a group-level sentence cannot tell
four different reactions apart. Groups absent from `catalog.motions`, and
entries past a group's motion count, are ignored. Matching meanings are
appended to the `playMotion` tool's `index` parameter description and to the
instructions.

When either is absent, or when none of its keys match, the outputs are
unchanged. The formatting is internal to this package. The director's classifier
prompt uses the same descriptions.

## Migrating From `@charivo/realtime-avatar`

`@charivo/realtime-avatar` is deprecated; its published versions re-export
this package.
Replace the dependency and imports:

```bash
s/@charivo\/realtime-avatar/@charivo\/avatar/
```

Every tool-calling export listed above is unchanged. The director exports
(`createAvatarDirector`, `connectAvatarDirectorToCascade`,
`createLLMAvatarClassifier`) are new and were never part of
`@charivo/realtime-avatar`.
