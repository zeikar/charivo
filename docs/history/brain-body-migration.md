# Brain/Body Migration — 2026-11

Reference note for moving an app from the LLM-in-core API to the
brain/body split. `Charivo` is now the body of the character (it speaks,
shows and reacts); a `ConversationBrain` decides what to say and drives that
body. `@charivo/llm`'s `createCascadeBrain(llm)` is the brain for the cascade
(LLM, then TTS) path. This is the one place that still names the removed API.

`userSay()` is **removed**, not deprecated: there is no sugar for it and no
release in which both exist. `brain.submit(...).done` replaces it. Every other
row below is a plain rename or a change of where the thing lives.

## Migration Table

| Before | After |
| --- | --- |
| `createCharivo({ llm })`, `attachLLM`, `detachLLM`, `getLLMManager` | `createCharivo({ brain: createCascadeBrain(llm) })`, `attachBrain`, `detachBrain`, `getBrain` |
| `charivo.userSay(text)` | `brain.submit({ kind: "user", text }).done` (removed, not deprecated) |
| `charivo.clearHistory()` / `getHistory()` | `brain.clearHistory()` / `brain.getHistory()` |
| `charivo.interrupt()` cancels the turn and its speech | `charivo.interrupt()` stops speech only; `turn.cancel()` / `brain.interrupt()` cancel a turn still generating |
| `character:speak`, `tts:start`, `tts:end`, `tts:error` | `performance:start` / `performance:end` |
| `turn:cancelled { userMessageId }` | `turn:cancelled { turnId }` |
| User messages passed to `RenderManager.render` | read from `message:sent` |
| `connectAvatarDirectorToCascade` | `connectAvatarDirectorToPerformances` |
| vtuber cue envelope (`[DIRECTOR]`, `[EVENT]`, `[CHAT]`), `applyShowProtocol`, `withEnvelopeTagGuard` | `direction` / `event` / `user` inputs and the brain's `review` hook; the Director keeps its queue |
| `dispose()` rejects with a failing step's own `CharivoError` code | `dispose()` always rejects with `CHARIVO_DISPOSE_ERROR`, the original as `cause` |
| `attachRealtime()` accepted during `dispose()` | `attachRealtime()` and `perform()` throw `CharivoStateError` until the teardown is done |

## Before And After

### Creating the instance

```ts
// Before
const charivo = createCharivo({ renderer, llm, tts });

// After
const charivo = createCharivo({
  renderer,
  brain: createCascadeBrain(llm),
  tts,
});
```

`attachLLM(llm)`, `detachLLM()` and `getLLMManager()` become
`attachBrain(brain)`, `detachBrain()` and `getBrain()`. The brain gets the body
and the character from `Charivo`; core imports nothing from `@charivo/llm`.

### Sending a message

```ts
// Before
try {
  await charivo.userSay(text);
} catch (error) {
  showError(error);
}

// After
const result = await charivo.getBrain()?.submit({ kind: "user", text }).done;
if (result?.status === "failed") {
  showError(result.error); // result.stage: "generate" | "render" | "tts"
}
```

`done` never rejects. A generation or render failure is `failed` with that
`stage`; a TTS failure is `failed` at `tts` with the reply kept in history.
Other inputs go through the same call: `{ kind: "event", source, text }` for
something that happened in the character's world and `{ kind: "direction",
text }` for a private stage direction.

### History

```ts
// Before
charivo.clearHistory();
const messages = charivo.getHistory();

// After
const brain = charivo.getBrain();
brain?.clearHistory();
const messages = brain?.getHistory();
```

### Interrupting

```ts
// Before: cancelled the turn and its speech
await charivo.interrupt();

// After: speech only
await charivo.interrupt();
// A turn still generating is cancelled through the brain attached to the body
await charivo.getBrain()?.interrupt();
// or through the handle `submit()` returned: await turn.cancel();
```

`attachRealtime()` throws while a performance holds the floor or cancelled
speech is unsettled, so an app switching into realtime awaits
`charivo.interrupt()` first.

### Speech events

```ts
// Before
charivo.on("character:speak", ({ text }) => showCaption(text));
charivo.on("tts:start", () => setSpeaking(true));
charivo.on("tts:end", () => setSpeaking(false));
charivo.on("tts:error", ({ error }) => report(error));

// After
charivo.on("performance:start", ({ text }) => {
  if (text !== undefined) showCaption(text);
});
charivo.on("floor:changed", ({ floor }) => {
  setSpeaking(floor.state === "speaking");
});
charivo.on("performance:end", ({ status, error }) => {
  if (status === "failed" && error) report(error);
});
```

`performance:start` carries the text for a string performance only; a stream
announces each sentence with `performance:segment`. A TTS failure ends the
performance `failed` with its `error`.

### Cancelled turns

```ts
// Before
charivo.on("turn:cancelled", ({ userMessageId }) => drop(userMessageId));

// After
charivo.on("turn:cancelled", ({ turnId }) => drop(turnId));
```

`turnId` is the id of the turn's input message, the same id `message:sent`
carries and `turn.id` returns.

### The user's own message

```ts
// Before: the render callback also received the user's message
renderManager.setMessageCallback((message) => addMessage(message));

// After: the callback delivers the character's lines only
renderManager.setMessageCallback((message) => addMessage(message));
charivo.on("message:sent", ({ message }) => {
  if (message.type === "user") addMessage(message);
});
```

`message:sent` covers every input, so a chat UI filters on `message.type`
(`user`, `event` or `direction`).

### Driving the avatar from the spoken line

```ts
// Before
const disconnect = connectAvatarDirectorToCascade(charivo, avatarDirector);

// After
const disconnect = connectAvatarDirectorToPerformances(charivo, avatarDirector);
```

The new helper acts on voiced performances only and follows a stream sentence
by sentence.

### The vtuber cue envelope

```ts
// Before: tags in the text, a protocol in the prompt, a client wrapper
await charivo.userSay(`[DIRECTOR] ${cue}`);
const llm = createLLMManager(withEnvelopeTagGuard(createRemoteLLMClient(...)));
character.personality += SHOW_PROTOCOL_INSTRUCTIONS; // applyShowProtocol

// After: typed inputs and a review hook
const brain = createCascadeBrain(
  createLLMManager(client, { directionRole: "user" }),
  {
    review: ({ reply, directions }) =>
      repeatsADirection(reply.text, directions) ? null : reply,
  },
);
await brain.submit({ kind: "direction", text: cue }).done;
```

A `direction` is ephemeral by default, so it is never stored in history, and
`review` sees the reply together with the request's directions before
anything is shown or spoken. It returns the reply to present, returns `null`
to say nothing, or throws to fail the turn. The Director keeps its own queue
and pacing; only the way a line reaches the character changed.
`examples/vtuber` is the worked example.

### Disposing

```ts
// Before: a typed CharivoError kept its own code
try {
  await charivo.dispose();
} catch (error) {
  if (isCharivoError(error) && error.code === "CHARIVO_PROVIDER_ERROR") {
    // ...
  }
}

// After: every failure is a dispose error; the original is its cause
try {
  await charivo.dispose();
} catch (error) {
  if (isCharivoError(error) && error.code === "CHARIVO_DISPOSE_ERROR") {
    const original = error.cause;
  }
}
```

From the `dispose()` call until its teardown is done, `perform()` and
`attachRealtime()` throw `CharivoStateError`, and a second `dispose()` returns
the same promise.
