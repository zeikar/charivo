# AGENTS

Read [README.md](./README.md) first for the current architecture, package map, and release flow.

## Core Rules

- Preserve the current layering: `@charivo/core` -> `*-core` managers -> browser clients/players/transcribers/renderers -> server providers.
- Do not collapse package boundaries or redesign the architecture unless explicitly requested.
- Keep docs aligned with actual behavior. If code changes public behavior, update the relevant README.

## Validation

- Run `pnpm verify` for repo-wide validation.
- Run `pnpm pack:check` before release-related changes.
- Run `pnpm build:web` when the demo app or bundling behavior changes.

## Versioning

- If a publishable package changes in a way that should reach npm, add a changeset with `pnpm changeset`.
- Do not add a changeset for docs-only or demo-only changes.
- Use `minor` for public API or contract changes.
- Use `patch` for fixes, packaging corrections, and non-breaking updates.
- Do not manually edit published package versions.
