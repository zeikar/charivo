# Contributing

Read [README.md](README.md) first for the current architecture, package layout, and release workflow.

## Setup

```bash
pnpm install
```

## Validation

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

Do not edit published package versions by hand.
