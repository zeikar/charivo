# @charivo/realtime-avatar

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
