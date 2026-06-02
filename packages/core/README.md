# @charivo/core

`@charivo/core` is the contract layer for the Charivo workspace.

It exports:

- `Charivo`: the top-level orchestrator
- shared domain types such as `Character`, `Message`, and realtime session types
- interface contracts for LLM, render, TTS, STT, and realtime managers
- the typed `EventBus`

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

`detachRenderer()` disconnects the render manager's event-bus listeners without
destroying the manager, so it remains reusable. Calling `attachRenderer(newManager)`
automatically disconnects the previously-attached manager before wiring the new one.

The current render-manager contract is explicit: a `RenderManager` must expose
`setEventBus(eventBus)` and `disconnect()` so the core can connect and cleanly
tear down typed character, TTS, and realtime events without duck typing.

## Errors

Public methods throw typed errors exported from `@charivo/core`:

- `CharivoStateError`
- `CharivoTimeoutError`
- `CharivoTransportError`
- `CharivoProviderError`
- `CharivoDisposeError`

Prefer `instanceof CharivoError` or `error.code` checks over
`error.message.includes(...)`.

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
- `stt:stop`
- `stt:error`
- `realtime:session:start`
- `realtime:session:end`
- `realtime:state`
- `realtime:user:transcript`
- `realtime:assistant:start`
- `realtime:assistant:delta`
- `realtime:assistant:done`
- `realtime:tool:call`
- `realtime:tool:result`
- `realtime:tool:error`
- `realtime:usage`
- `realtime:expression`
- `realtime:motion`
- `realtime:gaze`
- `realtime:text:delta`
- `realtime:error`
