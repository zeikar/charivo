# @charivo/realtime-avatar

## 0.3.5

### Patch Changes

- Updated dependencies [d168d35]
  - @charivo/realtime@0.8.2

## 0.3.4

### Patch Changes

- Updated dependencies [a8fd4b3]
- Updated dependencies [c4e206f]
  - @charivo/realtime@0.8.1

## 0.3.3

### Patch Changes

- Updated dependencies [3c2418a]
- Updated dependencies [8f7d277]
- Updated dependencies [d7de06e]
  - @charivo/realtime@0.8.0
  - @charivo/core@0.12.0

## 0.3.2

### Patch Changes

- Updated dependencies [f773b55]
  - @charivo/realtime@0.7.2

## 0.3.1

### Patch Changes

- 6598f6b: Rewrite realtime and avatar prompts in a descriptive tone instead of count-prescriptive language. The avatar instruction addendum now emits expression, motion, and pairing guidance only when those tools are available in the active catalog. Tool descriptions and the default realtime prompt drop quantifiers like "single", "one", and "at most one" in favor of quality framing such as "don't stack body motions in the same reply".
- Updated dependencies [6598f6b]
  - @charivo/realtime@0.7.1

## 0.3.0

### Minor Changes

- 9cef27f: Make generic realtime tool prompting more proactive, and add avatar-specific instruction helpers for expression, motion, and gaze behavior.

### Patch Changes

- Updated dependencies [9cef27f]
- Updated dependencies [8826f2b]
  - @charivo/realtime@0.7.0
  - @charivo/core@0.11.0

## 0.2.0

### Minor Changes

- 79df4cc: Make `@charivo/realtime` renderer-neutral by moving avatar-specific realtime
  tools into the new optional `@charivo/realtime-avatar` package.

  Add `RealtimeManager` result projectors and structured logger hooks, and emit
  the new `realtime:usage` core event when transport usage metadata is available.

  Breaking changes:
  - avatar tool helpers are no longer exported from `@charivo/realtime`
  - apps should import avatar realtime helpers from `@charivo/realtime-avatar`
  - avatar expression/motion/gaze events now come from configured result
    projectors rather than hardcoded tool-name handling inside `RealtimeManager`

### Patch Changes

- Updated dependencies [79df4cc]
  - @charivo/core@0.10.0
  - @charivo/realtime@0.6.0
