---
title: LLM
sidebar_position: 6
---

# LLM

Charivo's LLM layer is built from two pieces:

- `@charivo/llm` for conversation state
- an `LLMClient` implementation for transport

For production browser apps, pair `@charivo/llm` with `@charivo/llm/remote`
and a server route backed by a provider package.

## Recommended Stack

```text
@charivo/llm
@charivo/llm/remote
your /api/chat route
@charivo/server/openai
```

This keeps the browser client simple and vendor credentials on the server.

## Basic Setup

```ts
import { createCharivo } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";

const charivo = createCharivo({
  llm: createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
  character: {
    id: "hiyori",
    name: "Hiyori",
    personality: "Cheerful and helpful assistant",
  },
});
```

`createCharivo` applies the character after attaching, so it reaches the LLM,
rendering, and realtime managers together. When you attach by hand instead,
call `charivo.setCharacter(...)` after the `attach*` calls to keep that
character state aligned.

## Client Choices

### Remote

- `@charivo/llm/remote`
- best default for production browser apps
- expects your route to receive `messages` and return `{ success, message }`

### Direct OpenAI

- `@charivo/llm/openai`
- useful for local development and testing
- exposes credentials to the browser

### Direct Gemini

- `@charivo/llm/gemini`
- useful for local development and testing
- exposes credentials to the browser

### Direct OpenClaw

- `@charivo/llm/openclaw`
- useful when your app targets an OpenClaw deployment directly
- best treated as a development or trusted-environment option unless browser access is intentional

### Stub

- `@charivo/llm/stub`
- useful for UI work, deterministic demos, and tests

## Provider Choices

Remote clients pair with provider packages on the server:

- `@charivo/server/openai`
- `@charivo/server/openclaw`
- `@charivo/server/gemini` — Gemini 3 rejects a resent tool-call turn that
  lacks a thought signature, so this provider sends Google's documented
  `skip_thought_signature_validator` placeholder on the first tool call of
  each turn, and reasoning continuity across tool rounds is lost

Minimal OpenAI route shape:

```ts
const provider = createOpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.6-luna",
});

const text = await provider.generateResponse(messages);
```

The OpenAI provider defaults to `gpt-5.6-luna` and sends it with
`reasoning_effort: "none"`: in chat completions that model accepts function
tools and a custom `temperature` only with reasoning off. For another gpt-5
family model, set `reasoningEffort` yourself (`"none"` if you use tools);
models without reasoning, such as `gpt-4.1-mini`, reject the parameter, so it
is not sent for them unless you set it.

## What `@charivo/llm` Owns

- message history
- character-aware prompt building
- response generation through an injected client

The client is replaceable. The manager remains the stable place for
conversation state.

## Avatar Tool Calling

`LLMManager` can drive `@charivo/avatar`'s tools the same way
`RealtimeManager` does, on top of the recommended remote stack. For what belongs
in the catalog below — and how to establish what an expression id actually
means — see [Avatar Control](./avatar.md). The tool loop
turns on only when both a tool is registered and the client implements
`callWithTools` — `@charivo/llm/remote` does, provided your route forwards
`tools` to a provider's `generateResponseWithTools`. If the tool loop's extra
requests matter, the
[text-driven director](./avatar.md#text-driven-director) is the alternative.

```ts
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

const catalog = {
  expressions: ["Smile", "Sad"],
  motions: { Idle: 2, TapBody: 2 },
  expressionDescriptions: { Smile: "happy or amused", Sad: "downcast or disappointed" },
  motionDescriptions: { Idle: ["resting", "shifting weight"], TapBody: ["waves hello", "folds her arms"] },
};

const manager = createLLMManager(
  createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
  {
    tools: createAvatarControlTools(catalog),
    resultProjectors: [createAvatarResultProjector()],
    toolInstructions: buildAvatarControlInstructions(catalog),
  },
);

charivo.attachLLM(manager);
```

`attachLLM(...)` wires the event emitter `resultProjectors` need to turn
successful tool calls into `avatar:expression` / `avatar:motion` /
`avatar:gaze` events; a `RenderManager` on the same `Charivo` instance already
listens for them. The same emitter publishes `tool:call` / `tool:result` /
`tool:error` around every tool execution — the events `RealtimeManager` emits
too, so tool activity stays observable from one place.

On the server side, your route needs to accept an optional `tools` array and
call the tool-calling variant of your provider whenever the request needs it —
that includes both a `tools`-carrying request (even `tools: []`, the terminal
round) and a plain request whose `messages` already contain a tool-call or
tool-result turn:

```ts
const { messages, tools } = parsedBody;
const needsTools = requiresToolCallingPath(parsedBody);

const result = needsTools
  ? await provider.generateResponseWithTools(messages, tools ?? [])
  : { content: await provider.generateResponse(messages) };

return NextResponse.json({
  success: true,
  message: result.content,
  toolCalls: "toolCalls" in result ? result.toolCalls : undefined,
});
```

See [`examples/web/src/app/api/chat-request.ts`](https://github.com/zeikar/charivo/blob/main/examples/web/src/app/api/chat-request.ts)
for the full request-parsing and validation this demo uses (`parseChatRequest`
and `requiresToolCallingPath`).

The tool loop runs at most 3 rounds before a final `tools: []` call forces a
text-only reply, and only the final assistant text is added to
`LLMManager`'s history — see [Tool Calling](https://github.com/zeikar/charivo/blob/main/packages/llm/README.md#tool-calling)
in the package README for the full round-cap and remote protocol details.

## History Retention

`LLMManager` keeps the latest 40 turns by default. A turn is one user message
plus one character response, so `getHistory()` and LLM client calls are bounded
to the latest 80 stored messages. This keeps long-running chat sessions from
growing memory and context cost without additional app code.

Override the limit with `createLLMManager(client, { maxHistoryTurns })`, or use
`maxHistoryTurns: null` for unbounded history.

Eviction trims to the exact bound and takes any reply it strands at the head
with it, so overlapping `generateResponse(...)` calls at a tight limit cannot
leave a transcript of replies that answer nothing.

Events and directions (see below) are stored messages too and count against
the same bound. When the window sent with a request cuts into the history and
lands on a reply, that reply is left out of the prompt; a reply that really
opens the history, such as one answering an ephemeral direction, is sent.

Realtime sessions maintain conversation state on the provider side and are not
affected by `maxHistoryTurns`.

## Typed Input

Not everything a character hears is a person talking. `Message.type` has five
values, and each reaches the model one way:

| `Message.type` | Role sent | Content sent |
| --- | --- | --- |
| `user` | `user` | the text, as `<source>: <text>` when `source` names the speaker |
| `character` | `assistant` | the text |
| `system` | `system` | the text |
| `direction` | `system` (or `user`, see below) | a private stage-direction prefix, then the text |
| `event` | `user` | `<event source="...">text</event>`, both escaped and capped |

- A `direction` is the app's own cue ("move on to the next topic"). It stays at
  instruction level and is never mistaken for something a viewer said.
- An `event` is data from outside the app (a game, a donation feed), so it never
  gets system authority, whichever role directions use. Its source and text are
  escaped, so neither can close the wrapper, then capped (64 and 2,000
  characters as sent, entities intact); the source is kept on one line. The
  system prompt tells the model the wrapper is information, not instructions.
- In a `user` turn, speaker name included, the reserved markers cannot appear
  verbatim: every direction prefix gets a backslash in front and the `<` of
  every event tag becomes `&lt;`, matched in any letter case, anywhere in the
  turn, and through invisible format characters or unusual spaces inside the
  marker. The rest of the text is sent untouched. A speaker name is kept on
  one line.
  This keeps a viewer from reproducing either marker; it cannot stop a model
  from believing a paraphrase.

The explanation of both markers is added to the system prompt only when the
prompt carries a direction or an event.

**Gemini needs `directionRole: "user"`.** Gemini's OpenAI-compatible endpoint
folds every `system` message into its system instruction: a mid-history
direction loses its place, and a prompt that ends in one is rejected with
`400 Requests ending with a model turn are not supported`. With
`createLLMManager(client, { directionRole: "user" })` a direction goes out as a
`user` turn with the same prefix, which Gemini follows. OpenAI follows
directions with the default `"system"`. The same folding applies to plain
`type: "system"` history entries on Gemini, so keep those out of the middle
and the end of a Gemini prompt. Measured in
[`tests/live-llm/README.md`](https://github.com/zeikar/charivo/blob/main/tests/live-llm/README.md).

`BrainInput` in `@charivo/core` describes an input together with two
independent policies, and `resolveBrainInput(input)` from `@charivo/llm` turns
it into the `Message` it becomes, with the defaults filled in:

| `kind` | default `respond` | default `history` |
| --- | --- | --- |
| `user` (optional `speaker`) | `must` | `keep` |
| `event` (required `source`) | `auto` | `keep` |
| `direction` | `must` | `ephemeral` |

`respond` (`must` / `auto` / `silent`) says whether a reply is wanted; `history`
says what happens to the input itself. The manager provides the history side:

- `keep`: `addToHistory(message)`.
- `ephemeral`: `generateResponse(message, { ephemeral: true })` shows the
  message to the model for that request only and never stores it.
- `{ replaceKey }`: `addToHistory(message, { replaceKey })` removes the entry
  last stored under that key, so only the latest state (a score, the current
  scene) occupies the history.

A reply is always kept, whatever the input's policy, and it stays when its
input is replaced or was never stored: the history can then hold a reply with
nothing before it, or two replies in a row. The manager sends those as they
are. Deciding `respond` (when
to generate, and what `auto` means) is the caller's job; `Charivo.userSay()`
still sends plain user turns.

**OpenClaw with a pinned session.** A provider created with `sessionKey` sends
the gateway only the system prompt (the first message) and the latest turn, because the
gateway keeps the conversation itself. The gateway retains every turn it
receives, so `ephemeral` and `replaceKey` cannot take anything back from it,
and a `silent` input that only went to local history never reaches it. Those
three policies hold only on an unpinned session, which is what the
`@charivo/llm/openclaw` browser client always uses.

## Under `Charivo` Orchestration

The turn's history writes belong to `Charivo`, not to the manager:
`userSay(text)` places the user message through `addToHistory(...)`, calls
`generateResponse(..., { callerOwnsHistory: true })` so the manager writes
nothing for that call, and commits the reply once the turn reaches
presentation. That is what keeps a superseded turn's user message in history
while its unspoken reply never enters it — see the latest-wins turn contract in
the [core README](https://github.com/zeikar/charivo/blob/main/packages/core/README.md#charivo).
`maxHistoryTurns` applies to those messages like any other.

`Charivo` also passes a per-turn `signal` alongside `isCancelled`, so a
superseded turn's in-flight request is aborted when the client honors it.
`@charivo/llm/remote` does; the direct OpenAI and Gemini dev clients ignore it
and run to completion. A custom `LLMManager` should forward `signal` to its
client — the built-in one already does.

## Alternatives

- Use OpenClaw when your backend or testing flow targets OpenClaw instead of OpenAI.
- Use Gemini when you already hold a Gemini API key for Gemini Live realtime voice and want one vendor for both text chat and voice.
- Use the stub client when you want UI behavior without network or model variability.
- Use direct browser clients only when development speed matters more than credential isolation.

## References

- [LLM Package README](https://github.com/zeikar/charivo/blob/main/packages/llm/README.md)
- [Examples Web](./examples-web.md)
