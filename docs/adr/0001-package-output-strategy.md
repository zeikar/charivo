# ADR 0001: Package Output Strategy

## Status

Accepted

## Context

Charivo does not currently ship one uniform package output format.

Most publishable libraries ship dual-format output (`cjs + esm + .d.ts`) so npm
consumers can use both `require(...)` and `import`.

Some packages are ESM-only today because they are browser-first, test-oriented,
or otherwise do not need a CommonJS entrypoint:

- `@charivo/shared`
- `@charivo/llm-client-remote`
- `@charivo/llm-client-stub`
- `@charivo/render-stub`
- `@charivo/render-live2d`

`@charivo/shared` remains an acceptable ESM-only exception because it is a small
internal utility package used within the monorepo rather than a primary public
integration point.

`@charivo/render-live2d` is also a deliberate exception because it is a
browser/ESM-oriented package with custom declaration generation and bundling
constraints around the vendored Live2D runtime.

## Decision

Charivo will keep the current mixed output strategy for now.

Rules:

- Default to dual-format output (`cjs + esm + .d.ts`) for general-purpose
  publishable libraries where npm consumers may reasonably expect `require(...)`
- Allow ESM-only output only when the package is browser-only, internal,
  stub/demo-oriented, or has a clear technical reason
- Use `.d.mts` only for ESM-only packages
- Keep `.d.ts` for dual-format packages

We are not normalizing all packages to one output strategy in this batch.

## Consequences

This avoids churn in public package manifests and keeps current consumer
contracts stable.

Future package-output changes should follow this policy unless there is an
explicit request to revisit the repo-wide strategy.
