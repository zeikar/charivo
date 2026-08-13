# @charivo/avatar

Catalog-constrained avatar control tools for Charivo LLM and realtime sessions.

`@charivo/avatar` depends only on `@charivo/core`. It builds `setExpression`,
`playMotion`, and `lookAt` tool definitions/handlers from your model's
expression and motion catalog, plus a matching instruction string and a result
projector that turns successful tool calls into `avatar:*` events.

Pair `createAvatarControlTools(...)` with `buildAvatarControlInstructions(...)`
when you want the model to use avatar actions proactively. Keep those
instructions in the app/session layer rather than in `@charivo/llm` or
`@charivo/realtime` so non-avatar sessions in those packages stay generic.

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

## Events

`createAvatarResultProjector()` emits, on successful tool execution:

- `avatar:expression` — `{ expressionId }`
- `avatar:motion` — `{ group, index }`
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

## Expression Descriptions

`catalog.expressionDescriptions` is an optional `Record<string, string>` of
expression IDs to short meanings. Keys are expression IDs from
`catalog.expressions`; keys that don't match are ignored. When present,
matching meanings are appended to the `setExpression` tool's `expressionId`
parameter description and to `buildAvatarControlInstructions(...)` output.
When absent, or when none of its keys match, both outputs are unchanged. The
formatting is internal to this package — the Exports list above is unchanged.

## Migrating From `@charivo/realtime-avatar`

`@charivo/realtime-avatar` is deprecated; its published versions re-export
this package.
Replace the dependency and imports:

```bash
s/@charivo\/realtime-avatar/@charivo\/avatar/
```

All exports listed above are unchanged.
