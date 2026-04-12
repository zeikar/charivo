# @charivo/core

`@charivo/core` is the contract layer for the Charivo workspace.

It exports:

- `Charivo`: the top-level orchestrator
- shared domain types such as `Character`, `Message`, and `Emotion`
- interface contracts for LLM, render, TTS, STT, and realtime managers
- the typed `EventBus`

## Install

```bash
pnpm add @charivo/core
```

## Usage

```ts
import { Charivo, Emotion } from "@charivo/core";

const charivo = new Charivo();

charivo.setCharacter({
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and helpful assistant",
  emotionMappings: [
    {
      emotion: Emotion.HAPPY,
      expression: "f02",
      motion: { group: "TapBody", index: 0 },
    },
  ],
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
- `setCharacter(character)`
- `userSay(text)`
- `clearHistory()`
- `getHistory()`
- `on(event, listener)`
- `off(event, listener)`

The current render-manager contract is explicit: a `RenderManager` must expose
`setEventBus(eventBus)` so the core can connect typed character, TTS, and
realtime events without duck typing.

Emotion parsing keeps the current simple rule: if a message contains multiple
valid emotion tags, the last valid tag wins and all emotion tags are stripped
from the rendered text.

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
- `realtime:emotion`
- `realtime:text:delta`
- `realtime:error`
