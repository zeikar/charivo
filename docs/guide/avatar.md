---
title: Avatar Control
sidebar_position: 10
---

# Avatar Control

`@charivo/avatar` is optional. It turns your model's expressions and motions
into a catalog and drives the `avatar:*` events `@charivo/render` already
listens for, in one of two ways:

- **Tools** — the model calls the catalog as tools, so the character decides when
  to smile, wave, or look somewhere, and successful calls bridge back into the
  events.
- **Text-driven director** — the model writes only text, and a separate small
  classifier call picks the expression and motion for each spoken line. See
  [Text-Driven Director](#text-driven-director).

It is a separate install. In tool mode the same tools serve both conversation
paths: `LLMManager` and `RealtimeManager` take the same `ToolRegistration[]`.
The director's shipped wiring is cascade-only.

```bash
pnpm add @charivo/avatar
```

## Do You Need It?

Not if your app decides what the avatar does. A button or any rule of your own
can drive the avatar by emitting the events directly:

```ts
charivo.emit("avatar:expression", { expressionId: "F01" });
charivo.emit("avatar:motion", { group: "TapBody", index: 0 });
charivo.emit("avatar:gaze", { x: 0.2, y: -0.1 });
```

Emit on the bus rather than calling the renderer, so `RenderManager` stays the
single owner of expression state — including the auto-release in
[Rendering](./rendering.md#expression-auto-release).

If you want a separate pass over the reply, that is the
[text-driven director](#text-driven-director): it runs a classifier over each
spoken line and emits these events for you.

Reach for the tool mode when you want the *model* to decide. What it adds over
raw events is vocabulary and guard rails: the tool schema pins
`expressionId` and `group` to `enum`s built from your catalog, the handlers
re-check arguments and fail the call rather than forwarding an invented id, and
the instruction builder tells the model what those ids mean.

## What `@charivo/avatar` Owns

- catalog-constrained `setExpression`, `playMotion`, and `lookAt` tool
  definitions
- catalog-aware instruction text
- a result projector that turns successful calls into `avatar:expression`,
  `avatar:motion` (asking for `muteSound`, so a motion's baked-in sample clip
  does not talk over the character), and `avatar:gaze`
- a text-driven director that classifies each spoken line against the catalog
  and emits `avatar:expression` and `avatar:motion` (also with `muteSound`),
  without gaze

It owns no rendering and no session state. It builds on `@charivo/core`'s
neutral contracts — `ToolRegistration` / `ToolResultProjector` for the tools,
`CharivoEventEmitter` / `CharivoEventBus` and `LLMClient` for the director — and
sits beside the manager packages rather than inside either one.

## Building The Catalog

`expressions` and `motions` belong to the loaded model, so read them off the
renderer instead of hand-maintaining a list. A renderer that implements
`getAvatarControlCatalog()` hands over the whole catalog — names, counts and,
where the model carries them, descriptions; prefer it when present.
`@charivo/render-iki` implements it with the descriptions the `.iki` file
declares for every expression and motion. Otherwise assemble the catalog from
the two getters and descriptions you write:

```ts
import type { AvatarControlCatalog } from "@charivo/core";

const catalog: AvatarControlCatalog = renderer.getAvatarControlCatalog?.() ?? {
  expressions: renderer.getAvailableExpressions?.() ?? [],
  motions: renderer.getAvailableMotionGroups?.() ?? {},
  expressionDescriptions,
  motionDescriptions,
};
```

An empty section removes its tool rather than registering an unusable one:
`setExpression` appears only when `expressions` is non-empty, `playMotion` only
when `motions` is, and `lookAt` is always registered — its handler clamps the
coordinates to `[-1, 1]`. A catalog read before the model finishes loading
therefore yields a gaze-only tool surface.

Rebuild it when the model changes — `readAvatarCatalog` in
[`examples/web/src/app/hooks/useCharivoChat.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/hooks/useCharivoChat.ts)
is the assembled form wired to a model switch.

When the model carries no descriptions, they are the part you write, and they
decide whether the model picks a face or picks the right one.

## Writing Descriptions

Cubism sample models name expressions `F01`, `exp_01`, and so on. The ids carry
no meaning, there is no authoritative published mapping for them, and mappings
that circulate online get them wrong. Derive them yourself:

1. Play each expression and motion in your own app and watch it. This is the
   only step that establishes meaning; everything else only confirms it.
2. Cross-check against the `.exp3.json` parameter deltas — but do not trust
   deltas alone. Haru's `F04` ("sad") and `F08` ("unimpressed, deadpan") set the
   identical `ParamMouthForm: -1.76`; they differ in the brows and eyes.
3. Write what you saw into your app config, not into the model. Renaming ids
   inside `model3.json` does not survive: those are vendor sample assets, and
   the next SDK refresh replaces them wholesale.
4. Pin the order you observed with a test. Motion indices are positional, so a
   reordered motion file silently reassigns every description after it —
   `examples/web/src/app/config/characters/index.test.ts` shows the shape.

Two things worth knowing before spending long on wording. An expression reads
weakly while the character speaks, because lip sync owns the mouth; the ones
that change or close the eyes are the ones that still read. And a motion group
usually holds several unrelated reactions, which is why `motionDescriptions` is
positional per index rather than one sentence per group.

## Text-Driven Director

Here the talking LLM writes only text. The director reads each spoken line,
makes one classifier call per line (no history), checks the decision against the
catalog, and emits `avatar:expression` and `avatar:motion` with
`muteSound: true`. It emits no gaze. `RenderManager` still owns the expression
hold and release; see
[Expression Auto-Release](./rendering.md#expression-auto-release).

The director drives only the body, not what the character says. The vtuber
example's separate show "Director" decides when to talk.

Choose it over tools when the tool loop's extra round trips matter, or when the
talking model should not see avatar tools at all. The talker makes one request
and the classifier adds one more per line, whereas the tool loop adds a round
trip per tool round.

```ts
import {
  connectAvatarDirectorToCascade,
  createAvatarDirector,
  createLLMAvatarClassifier,
} from "@charivo/avatar";

const director = createAvatarDirector({
  catalog,
  classifier: createLLMAvatarClassifier(llmClient),
  emitter: charivo,
});
const disconnect = connectAvatarDirectorToCascade(charivo, director);
```

Only cascade wiring ships: each voiced reply (`tts:start`) is one line. The
director also has `push(chunk)` and `done()` for streaming text, but nothing
wires them yet. The line ends on `tts:audio:end`, `tts:end`, `tts:error`, or
`turn:cancelled`, and a decision that arrives after that is dropped. A new line
also supersedes a pending decision. A turn that fails before TTS starts is never
classified. A text-only turn (no TTS manager) emits no `tts:start`, so the helper does not
classify it; call `director.say(text)` yourself where your app accepts the text
reply. Your app owns cancellation on that path: call `director.cancel()` if the
reply is later withdrawn.

The classifier is pluggable: an `AvatarClassifier` is a function from
`{ text, catalog, signal }` to a decision, so a rule-based or local classifier
replaces `createLLMAvatarClassifier(...)`. The director checks each field of the
decision against the catalog and silently drops one the model does not have, so
a valid expression still emits beside an invalid motion. Only a classifier that
rejects or throws reaches `onError` (default `console.warn`), and then nothing is
emitted. See the
[package README](https://github.com/zeikar/charivo/blob/main/packages/avatar/README.md#text-driven-director)
for the full contract.

## Wiring It Up

For the text-driven director, see [Text-Driven Director](#text-driven-director)
above. In tool mode both managers register the same tools, and each guide carries its
own recipe:

- LLM — [Avatar Tool Calling](./llm.md#avatar-tool-calling), including the
  server route that has to forward `tools`
- Realtime — [Basic Setup](./realtime.md#basic-setup) and
  [Tools](./realtime.md#tools)
- Where the events land —
  [What `@charivo/render` Adds](./rendering.md#what-charivorender-adds)

## Alternatives

- Skip avatar control entirely when the character only needs to talk — or drive
  it from the app instead, as [Do You Need It?](#do-you-need-it) describes.

## References

- [Avatar Package README](https://github.com/zeikar/charivo/blob/main/packages/avatar/README.md)
  — exports, event payloads, and migration from `@charivo/realtime-avatar`
- [Rendering](./rendering.md)
- [Examples Companion](./examples-companion.md)
