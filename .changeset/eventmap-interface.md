---
"@charivo/core": minor
---

Make `EventMap` an interface so third parties can extend it.

`EventMap` was a closed type alias, so a package adding its own renderer or
manager had no way to carry custom events through the Charivo event bus without
a core change. As an interface it supports declaration merging:

```ts
import "@charivo/core";

declare module "@charivo/core" {
  interface EventMap {
    "vrm:blendshape": { name: string; weight: number };
  }
}
```

The `import` line is load-bearing: it makes the declaring file a module so the
block augments the package. Without it, in a standalone `.d.ts`, the same block
shadows `@charivo/core` and every other export disappears.

Every existing usage (`keyof EventMap`, indexed access, the
`CharivoEventBus`/`CharivoEventEmitter` signatures) compiles unchanged. The one
observable difference: an interface has no implicit index signature, so code
that assigned `EventMap` to `Record<string, ...>` would now need `keyof`-based
typing — nothing in this repo did.
