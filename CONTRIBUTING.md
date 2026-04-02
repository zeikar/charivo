# Contributing

Read [README.md](README.md) first for the current architecture, package layout, and release workflow.
Use [docs/release-checklist.md](docs/release-checklist.md) before merging a release PR.

## Prerequisites

- Node `>=18.0.0`
- pnpm `>=8.0.0`

## Setup

```bash
pnpm install
pnpm setup:hooks
```

## Daily Commands

```bash
pnpm test
pnpm test:watch
pnpm lint:fix
pnpm format
```

## Validation And Packaging

Run these before opening a release PR or shipping package changes:

```bash
pnpm verify
pnpm pack:check
```

If you changed the web demo or bundling behavior, also run:

```bash
pnpm build:web
```

## Changesets

Publishable package changes require a changeset:

```bash
pnpm changeset
```

Use a changeset when you change public package code, package metadata, exports, or runtime behavior.

Do not add a changeset for docs-only or demo-only changes.

## Release Flow

1. Land package changes with a changeset.
2. Push to `main`.
3. GitHub Actions opens the release PR.
4. Merge the release PR to publish bumped packages to npm.

## PR And Commit Notes

- Keep commit messages short and imperative.
- Use conventional prefixes when possible: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Mention the affected package or area when the change is scoped.

Do not edit published package versions by hand.
