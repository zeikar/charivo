# @charivo/shared

Small shared utilities used across the Charivo workspace.

## Install

```bash
pnpm add @charivo/shared
```

## Exports

- `CHARIVO_VERSION`
- `DEFAULT_CONFIG`
- `generateId()`
- `formatTimestamp(date)`
- `debounce(fn, wait)`
- `throttle(fn, limit)`

This package is intentionally small. It does not contain framework orchestration
logic; that lives in `@charivo/core`.
