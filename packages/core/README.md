# @charivo/core

`@charivo/core` is the contract layer for the Charivo workspace.

It exports:

- `Charivo`: the top-level orchestrator
- shared domain types such as `Character`, `Message`, and realtime session types
- interface contracts for LLM, render, TTS, STT, and realtime managers
- the event contracts `CharivoEventBus` and `CharivoEventEmitter`: the render
  manager receives a bus via `setEventBus(...)`, while the TTS/STT/LLM/Realtime
  managers receive an emitter via `setEventEmitter(...)`; the concrete bus
  implementation is internal, and consumers subscribe via `charivo.on/off(...)`
- `createLipSyncAnalyzer`: the shared audio-analysis utility the TTS manager
  and realtime clients use to compute mouth-open RMS and emit
  `tts:lipsync:update`
- modality-neutral tool contracts (`ToolDefinition`, `ToolRegistration`, ...)
  plus the validation and execution helpers (`validateToolArguments`,
  `assertToolResultObject`, `createToolRegistry`, `withToolTimeout`,
  `snapshotToolResult`, `createToolFailureOutput`) shared by `@charivo/llm`
  and `@charivo/realtime`

The public API is factory-first: pluggable managers/clients/players/
transcribers/renderers are created via `create*` factories and consumed
through their interfaces; concrete implementation classes are not
exported. `Charivo`, the `CharivoError` taxonomy, and the OpenAI/OpenClaw
provider classes (`OpenAILLMProvider`, `OpenClawLLMProvider`,
`OpenAITTSProvider`, `OpenAISTTProvider`, `OpenAIRealtimeProvider`) are
the three exceptions, exported directly as concrete classes: `Charivo`
owns the instance lifecycle (wiring managers, the event bus, and
`dispose()`) so it isn't behind a factory; `CharivoError` is a taxonomy
checked via `isCharivoError`/`error.code`, not constructed; the
OpenAI/OpenClaw providers are exported because consumers rely on
`instanceof` checks and provider methods outside the narrow core
interface — a contract `packages/server/__tests__/barrel.test.ts` pins;
their factories are also browser-callable via `dangerouslyAllowBrowser`
for dev/testing, not a "Node-only" restriction.
Subclassing `Charivo` is not supported — extend via composition.

## Install

```bash
pnpm add @charivo/core
```

## Usage

```ts
import { Charivo } from "@charivo/core";

const charivo = new Charivo();

charivo.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
});

charivo.on("message:received", ({ message }) => {
  console.log(message.content);
});
```

## `Charivo`

The `Charivo` instance wires managers together:

- `attachRenderer(renderManager)`
- `attachLLM(llmManager)`
- `attachTTS(ttsManager)`
- `attachSTT(sttManager)`
- `attachRealtime(realtimeManager)`
- `detachLLM()`
- `detachRenderer()`
- `setCharacter(character)`
- `userSay(text)`
- `dispose()`
- `clearHistory()`
- `getHistory()`
- `on(event, listener)`
- `off(event, listener)`

`detachRenderer()` disconnects the render manager's event-bus listeners and
releases any held expression, without destroying the manager, so it remains
reusable. Calling `attachRenderer(newManager)` automatically disconnects the
previously-attached manager before wiring the new one.

The current render-manager contract is explicit: a `RenderManager` must expose
`setEventBus(eventBus)` and `disconnect()` so the core can connect and cleanly
tear down typed character, TTS, and realtime events without duck typing.

### `RenderManager` public methods

Beyond the event-bus contract, `RenderManager` exposes optional public methods
for driving avatar state from the app layer:

- `setLocalGaze(coords: GazeCoordinates): boolean` — drives local-presence gaze
  (e.g. webcam face tracking). Returns `false` (no-op) while AI gaze owns the
  avatar (the `avatar:gaze` suspend window is active) or when the renderer has
  no `lookAt`.

## Errors

Public methods throw typed errors exported from `@charivo/core`:

- `CharivoStateError`
- `CharivoTimeoutError`
- `CharivoTransportError`
- `CharivoProviderError`
- `CharivoDisposeError`

Prefer `isCharivoError(error)` or `error.code` checks over
`error.message.includes(...)`. Raw `instanceof CharivoError` is only
guaranteed to work within a single installed copy of `@charivo/core`;
`isCharivoError` also recognizes branded errors thrown by a duplicated copy.
Symbol brands never survive serialization. `error.code` survives
`JSON.stringify` (it is a plain enumerable property), but `structuredClone`
and worker `postMessage` drop custom `Error` properties entirely — send an
explicit `{ code, message }` envelope across those boundaries instead of
relying on the error object itself.

## Tool Contracts

`@charivo/core` owns a modality-neutral tool contract used by both
`@charivo/llm` (`LLMManager`) and `@charivo/realtime` (`RealtimeManager`), so a
tool built once (e.g. by `@charivo/avatar`) registers with either manager:

- `ToolDefinition`: `{ type: "function", name, description, parameters }`, a
  JSON Schema-shaped function definition
- `ToolContext`: `{ character?, callId?, state? }` passed to a handler;
  `state` (a `RealtimeState`) is present only for realtime sessions
- `ToolHandler`: `(args, context) => Promise<Record<string, unknown>>` — must
  resolve to a plain object; arrays and primitives are rejected by the runners
- `ToolRegistration`: `{ definition, handler, timeoutMs? }`
- `ToolResultProjector` / `ToolResultProjectorContext`: `({ name, output,
  callId?, emit }) => void`, run by a manager after a successful tool call so
  app code can turn tool output into Charivo events (e.g. `avatar:expression`)

Validation helpers, used by both managers before/after a handler runs:

- `validateToolArguments(definition, args, toolLabel?)`: throws a plain
  `Error` on the first schema violation. Enforces only required-key presence,
  `enum` membership, and each property's top-level `type` — nested schemas,
  `additionalProperties`, and numeric-length constraints are not validated.
- `assertToolResultObject(result, toolName, toolLabel?)`: throws a plain
  `Error` unless `result` is a plain object.

Execution helpers, shared so both managers run tools with the same guarantees:

- `createToolRegistry(): ToolRegistry`: name-keyed registry
  (`register` / `unregister` / `get` / `size` / `getDefinitions`).
  `getDefinitions()` deep-copies, so a provider cannot mutate a registered
  schema.
- `withToolTimeout(promise, timeoutMs, toolName, toolLabel?)`: rejects with
  `${toolLabel} "${toolName}" timed out after ${timeoutMs}ms` and always clears
  its timer.
- `snapshotToolResult(result, toolName, toolLabel?): ToolResultSnapshot`:
  serializes once and returns `{ serialized, snapshot }` — the string for the
  model's tool turn or the transport, and its parsed form for the `tool:result`
  event and the result projectors. Call it inside a runner's failure boundary
  so an unrepresentable result degrades to a failure output: `JSON.stringify`
  returns the value `undefined` (without throwing) for a result whose
  `toJSON()` yields `undefined`, and a `toJSON()` can also yield null, an
  array, or a primitive, so the parsed value is re-checked against the
  tool-result contract. Both tool runners use this, which is what makes a tool
  result mean the same thing across modalities.
- `createToolFailureOutput(error)`: the always-serializable
  `{ success: false, error }` output handed back to the model when a call fails.

### LLM Tool-Calling Contracts

- `LLMMessage`: role-discriminated union (`system`/`user`, `assistant` with
  optional `toolCalls`, or `tool` with a required `toolCallId`) so
  protocol-invalid combinations are unrepresentable for typed callers
- `LLMToolCall`: `{ id, name, arguments }`
- `LLMToolResponse`: `{ content, toolCalls? }`
- `LLMProvider.generateResponseWithTools?(messages, tools)`: optional
  tool-calling variant a provider implements alongside `generateResponse`
- `LLMClient.callWithTools?(messages, tools)`: optional tool-calling variant a
  client implements alongside `call`
- `LLMManager.registerTool?`, `unregisterTool?`, `getRegisteredTools?`,
  `setToolInstructions?`: optional manager methods for managing the tool
  registry and the tool-only system-prompt addendum

## Events

Important event names include:

- `message:sent`
- `message:received`
- `character:speak`
- `tts:start`
- `tts:end`
- `tts:error`
- `tts:audio:start`
- `tts:audio:end`
- `tts:lipsync:update`
- `stt:start`
- `stt:partial`
- `stt:stop`
- `stt:error`
- `llm:error`
- `tool:call`
- `tool:result`
- `tool:error`
- `realtime:session:start`
- `realtime:session:end`
- `realtime:state`
- `realtime:user:transcript`
- `realtime:assistant:start`
- `realtime:assistant:delta`
- `realtime:assistant:done`
- `realtime:usage`
- `avatar:expression`
- `avatar:motion`
- `avatar:gaze`
- `realtime:error`

`avatar:gaze` (a bare `GazeCoordinates`) and `realtime:usage` (a flat
`RealtimeUsageEvent`) intentionally use flat payloads rather than wrapper
objects.

The event bus isolates each listener: one that throws is reported via
`console.error` and does not stop the listeners queued behind it, so `emit`
never throws into its caller.
