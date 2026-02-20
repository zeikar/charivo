# @charivo/render-stub

Console-based stub renderer for [Charivo](https://github.com/zeikar/charivo) that logs messages to the terminal — no browser or canvas required.

## Features

- Zero dependencies beyond `@charivo/core`
- Logs messages to `console.log` with timestamps and role indicators
- Useful for server-side testing, CLI tools, and headless environments
- Full `Renderer` interface implementation (`initialize`, `render`, `destroy`)

## Installation

```bash
npm install @charivo/render-stub
```

## Usage

### Basic

```typescript
import { ConsoleRenderer } from "@charivo/render-stub";

const renderer = new ConsoleRenderer();

await renderer.initialize();
// 🎭 ConsoleRenderer initialized

await renderer.render(
  { type: "user", content: "Hello!", timestamp: new Date() },
);
// 👤 [12:00:00 PM] User: Hello!

await renderer.render(
  { type: "character", content: "Hi there! [happy]", timestamp: new Date() },
  { name: "Aria", id: "aria" },
);
// 🎭 [12:00:01 PM] Aria: Hi there! [happy]

await renderer.destroy();
// 🎭 ConsoleRenderer destroyed
```

### With Charivo CharacterManager

```typescript
import { CharacterManager } from "@charivo/core";
import { ConsoleRenderer } from "@charivo/render-stub";

const manager = new CharacterManager({
  renderer: new ConsoleRenderer(),
  // ...other config
});

await manager.initialize();
```

### Testing / Headless Environments

```typescript
import { ConsoleRenderer } from "@charivo/render-stub";

// Swap in for a real renderer during tests
const renderer =
  process.env.NODE_ENV === "test"
    ? new ConsoleRenderer()
    : new Live2DRenderer({ canvasId: "canvas" });
```

## Output Format

| Message Type | Format |
|-------------|--------|
| `user` | `👤 [HH:MM:SS] User: <content>` |
| `character` | `🎭 [HH:MM:SS] <character.name>: <content>` |
| other | `ℹ️ [HH:MM:SS] System: <content>` |

## API Reference

### `ConsoleRenderer`

Implements the `Renderer` interface from `@charivo/core`.

#### Methods

- `initialize(): Promise<void>` — Logs initialization message.
- `render(message: Message, character?: Character): Promise<void>` — Logs the message to the console.
- `destroy(): Promise<void>` — Logs destruction message.

## Related Packages

- [`@charivo/render-live2d`](../render-live2d) — Live2D renderer (browser)
- [`@charivo/core`](../core) — Core interfaces (`Renderer`, `Message`, `Character`)

## License

MIT
