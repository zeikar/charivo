# Website

This website is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

It renders the guide from `docs/guide`, so edit the Markdown there rather than
copying pages into this directory.

## Installation

This site is part of the pnpm workspace — install from the repository root, not
from here:

```bash
pnpm install
```

## Local Development

```bash
pnpm --filter ./docs-site start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
pnpm --filter ./docs-site build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

Deployment is automated: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
builds this site and publishes it to GitHub Pages on every push to `main`. There
is no manual deploy step to run.
