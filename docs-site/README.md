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
pnpm --filter "docs-site^..." build
pnpm --filter ./docs-site start
```

The Playground imports the built `@charivo` packages, so the first command is
needed on a fresh checkout and again after any change under `packages/` the
Playground uses; the dev server does not rebuild them.

The second command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

```bash
pnpm --filter ./docs-site build
```

This command builds the `@charivo` packages the Playground uses (the `prebuild`
script), then generates static content into the `build` directory, which can be
served using any static contents hosting service.

## Playground

`src/pages/playground.tsx` (served at `/playground/`) drives an Iki character
with no API key or LLM. Its `.iki` models are the web demo's own copies in
`examples/web/public/iki`, served from the site root through
`staticDirectories` rather than copied here.

Its voice lines are `static/voice/*.m4a` (AAC, mono), AI-generated with Gemini
TTS: Twin's hello, laugh and sad lines with `gemini-3.8-flash-tts`, the rest
with `gemini-3.1-flash-tts-preview`. `src/components/Playground/lines.ts` lists
each file with the transcript it is spoken as; a line plays through
`@charivo/tts` with a player that fetches its file, so lip-sync comes from the
recording. Re-record a line by replacing its file and updating its `text`.

## Deployment

Deployment is automated: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
builds this site and publishes it to GitHub Pages on every push to `main`. There
is no manual deploy step to run.

## Analytics

`static/ga.js` loads zeikar.dev's GA4 tag, the same property as zeikar.dev
and Iki's pages, and only when the hostname is `zeikar.dev`, so local and
preview builds send nothing. A browser that once opened `zeikar.dev/?internal`
is reported as internal traffic. `src/ga.ts` sends a page view on each
client-side route change, since the property doesn't count history changes on
its own.
