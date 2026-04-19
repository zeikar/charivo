# AGENTS

Read [README.md](./README.md) first for the current architecture, package map, and release flow.

## Core Rules

- Preserve the current layering: `@charivo/core` -> modality packages -> browser clients/players/transcribers/renderers -> server providers.
- Do not collapse package boundaries or redesign the architecture unless explicitly requested.
- Keep the event split intentional: `RenderManager` uses `setEventBus(...)`, while TTS/STT/Realtime managers use `setEventEmitter(...)`. Do not normalize them into one contract unless explicitly requested.
- Default publishable packages to dual-format output (`cjs + esm + .d.ts`).
- Allow ESM-oriented output only for browser-only packages or when there is a clear technical reason.
- Use `.d.mts` only for ESM-only packages, and keep `.d.ts` for dual-format packages.
- Do not normalize package outputs (`.mjs`, `.d.mts`, dual-format manifests) unless explicitly requested.
- Keep docs aligned with actual behavior. If code changes public behavior, update the relevant README.

## Validation

- Run `pnpm verify` for repo-wide validation.
- Run `pnpm pack:check` before release-related changes.
- Run `pnpm build:web` when the demo app or bundling behavior changes.
- Do not run repo-wide validation commands in parallel. Execute `pnpm verify`, `pnpm build:web`, `pnpm pack:check`, and similar full-repo build/test commands sequentially because they share build outputs and can conflict with each other.
- Never read the full output of long-running commands (`pnpm verify`, `pnpm build`, `pnpm build:web`, `pnpm pack:check`, `pnpm test`, etc.) — it wastes context. Pipe through `tail` to inspect only the end, e.g. `pnpm verify 2>&1 | tail -n 100` or `pnpm --filter @charivo/realtime test 2>&1 | tail -n 60`. On failure, re-run and pipe through `grep` for the error context; only expand the window when the tail is insufficient to diagnose the problem.

## Versioning

- If a publishable package changes in a way that should reach npm, add a changeset with `pnpm changeset`.
- Do not add a changeset for docs-only or demo-only changes.
- Use `minor` for public API or contract changes.
- Use `patch` for fixes, packaging corrections, and non-breaking updates.
- Do not manually edit published package versions.
