---
"@charivo/core": minor
---

Pre-1.0 surface cleanup. Two breaking changes to the event surface, plus an additive hardening of error identification.

**Breaking — the `EventBus` class is no longer exported.** It was never meant to be constructed by consumers; subscribe via `charivo.on(...)` / `charivo.off(...)`, or type against the `CharivoEventBus` interface if you need the shape.

**Breaking — `character:speak` now carries its text under `text` instead of `message`** — `{ character, text }`. This resolves the naming collision with `message:sent` / `message:received`, which carry a `Message` object under `message`. Update any `character:speak` listener that reads `event.message` to read `event.text`. Note that a loosely-typed listener will not fail to compile — it will silently read `undefined` at runtime — so check every `character:speak` subscription, not just the ones the compiler flags.

**Additive — `CharivoError` instances now carry a `Symbol.for("@charivo/core/CharivoError")` brand, and `isCharivoError` recognizes branded errors from a duplicated `@charivo/core` install** (verifying `code` is one of the known error codes and `message` is a string). Existing `instanceof CharivoError` checks keep working unchanged within a single installed copy, so no migration is required. If your app can end up with more than one copy of `@charivo/core` — a monorepo, or dependents pinned to different versions — prefer `isCharivoError(error)`, which `instanceof` cannot answer correctly across copies. The symbol brand does not survive `JSON.stringify` or structured clone, so identify serialized or cross-process errors by `error.code`.
