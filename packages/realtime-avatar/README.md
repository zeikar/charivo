# @charivo/realtime-avatar

Avatar-specific realtime tool helpers for Charivo.

Use this package when a realtime session should drive expression, motion, or
gaze events for an avatar renderer.

Pair `createAvatarControlTools(...)` with
`buildAvatarControlInstructions(...)` when you want the model to use avatar
actions proactively. Keep those instructions in the app/session layer rather
than in `@charivo/realtime` so non-avatar realtime sessions stay generic.

## Exports

- `createAvatarControlTools(catalog)`
- `buildAvatarControlInstructions(catalog)`
- `createAvatarResultProjector()`
- `AVATAR_CONTROL_TOOL_NAMES`
- `SET_EXPRESSION_TOOL_NAME`
- `PLAY_MOTION_TOOL_NAME`
- `LOOK_AT_TOOL_NAME`
