# @charivo/realtime-avatar

**Deprecated.** This package now only re-exports `@charivo/avatar` and will be
removed in a future major version. It also no longer requires a realtime
session — the underlying tools work with both `RealtimeManager`
(`@charivo/realtime`) and `LLMManager` (`@charivo/llm`).

## Migration

Replace the dependency and imports:

```bash
s/@charivo\/realtime-avatar/@charivo\/avatar/
```

All exports (`createAvatarControlTools`, `buildAvatarControlInstructions`,
`createAvatarResultProjector`, `AVATAR_CONTROL_TOOL_NAMES`,
`SET_EXPRESSION_TOOL_NAME`, `PLAY_MOTION_TOOL_NAME`, `LOOK_AT_TOOL_NAME`) are
unchanged.

If you used `RealtimeToolResultProjector` from `@charivo/realtime`, switch to
the neutral `ToolResultProjector` re-exported from `@charivo/core` (and also
re-exported by `@charivo/realtime`) — `createAvatarResultProjector()` already
returns that type.

See [`@charivo/avatar`](../avatar/README.md) for full documentation.
