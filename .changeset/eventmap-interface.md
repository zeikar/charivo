---
"@charivo/core": minor
---

Make `EventMap` an interface so third parties can extend it.

`EventMap` was a closed type alias, so a package adding its own renderer or
manager had no way to carry custom events through the Charivo event bus without
a core change. As an interface it supports declaration merging:

```ts
declare module "@charivo/core" {
  interface EventMap {
    "vrm:blendshape": { name: string; weight: number };
  }
}
```

Every existing usage (`keyof EventMap`, indexed access, the
`CharivoEventBus`/`CharivoEventEmitter` signatures) compiles unchanged. The one
observable difference: an interface has no implicit index signature, so code
that assigned `EventMap` to `Record<string, ...>` would now need `keyof`-based
typing — nothing in this repo did.
