# charivo
Charivo — a tiny, pluggable Live2D + LLM toolkit. Swap adapters like LEGO bricks: renderer, LLM, emotion, TTS, STT… click! 🧱✨

## Development

This project uses pnpm for package management.

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Packages

- `@charivo/core` - Core functionality for Charivo character system
- `@charivo/react` - React components for Charivo
- `@charivo/render-live2d` - Live2D rendering engine for Charivo
- `@charivo/adapter-llm-openai` - OpenAI LLM adapter
- `@charivo/plugin-emotion-basic` - Basic emotion plugin
- `@charivo/shared` - Shared utilities

### Example Apps

Check out the examples in the `examples/` directory:

- `examples/web` - Next.js web example

To run the web example:

```bash
cd examples/web
pnpm dev
```
