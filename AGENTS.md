# AGENTS

Read [README.md](./README.md) first for the current architecture, package map, and release flow.

## Core Rules

- Preserve the current layering: `@charivo/core` -> `*-core` managers -> browser clients/players/transcribers/renderers -> server providers.
- Do not collapse package boundaries or redesign the architecture unless explicitly requested.
- Keep the event split intentional: `RenderManager` uses `setEventBus(...)`, while TTS/STT/Realtime managers use `setEventEmitter(...)`. Do not normalize them into one contract unless explicitly requested.
- Do not normalize package outputs (`.mjs`, `.d.mts`, dual-format manifests) unless explicitly requested.
- Keep docs aligned with actual behavior. If code changes public behavior, update the relevant README.
- Use [`docs/adr/0001-package-output-strategy.md`](./docs/adr/0001-package-output-strategy.md) as the source of truth for package output policy.

## Validation

- Run `pnpm verify` for repo-wide validation.
- Run `pnpm pack:check` before release-related changes.
- Run `pnpm build:web` when the demo app or bundling behavior changes.
- Do not run repo-wide validation commands in parallel. Execute `pnpm verify`, `pnpm build:web`, `pnpm pack:check`, and similar full-repo build/test commands sequentially because they share build outputs and can conflict with each other.
- Prefer log-efficient validation runs. When invoking long-running repo-wide commands, avoid streaming the full build log unless needed; capture or inspect the tail/end of the output first, then expand only around failures.

## Versioning

- If a publishable package changes in a way that should reach npm, add a changeset with `pnpm changeset`.
- Do not add a changeset for docs-only or demo-only changes.
- Use `minor` for public API or contract changes.
- Use `patch` for fixes, packaging corrections, and non-breaking updates.
- Do not manually edit published package versions.
