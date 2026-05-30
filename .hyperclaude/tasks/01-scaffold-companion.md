# 01 — Scaffold `examples/companion`

**Depends on:** none (foundation). **Run:** `/hyperclaude:hyper-auto` with the prompt below.

## Goal

Create the `examples/companion` Next.js app (monorepo sibling to `examples/web`)
that can start an OpenAI Realtime session and talk, exposing a clear
**instructions-composition seam** where persona / avatar / (future) memory
strings are assembled before `startSession({ instructions })`. No memory yet —
this only gives the later subtasks a home.

## In scope

- New `examples/companion` Next.js 15 app mirroring the minimal realtime flow in
  `examples/web` (app router, the `/api/realtime` ephemeral-token route handler,
  the hook that calls `startSession`). Reuse `@charivo/*` packages exactly the
  way web does. **Do not modify `examples/web`.**
- A single `composeInstructions([...])` function (mirror
  `examples/web/src/app/lib/realtime-instructions.ts`) that joins ordered string
  blocks — today just persona/avatar; later subtasks add a memory block here.
  This is the seam everything else plugs into.
- Workspace wiring: pnpm workspace membership, `package.json` name `companion`,
  dev/build/start scripts.
- Add `companion` to the changeset `ignore` list so it is never published.

## Out of scope

- Any memory storage, retrieval, extraction, persistence, or DB.

## Verify

- `pnpm install --frozen-lockfile` succeeds (workspace graph + lockfile valid).
- `companion` builds.
- `pnpm pack:check` still passes (companion is ignored / unpublished).
- (Optional, live) can start a realtime session and hold a short conversation.

## hyper-auto prompt

> Scaffold a new `examples/companion` Next.js 15 app per
> `.hyperclaude/tasks/01-scaffold-companion.md`. Mirror the minimal realtime
> flow from `examples/web` (app router, `/api/realtime` route, the startSession
> hook), reuse `@charivo/*` the same way, and expose a single
> `composeInstructions([...])` seam for ordered instruction blocks. Add
> `companion` to the changeset `ignore` list. Do not modify `examples/web` or
> any `@charivo/*` core. Honor all fixed constraints in
> `.hyperclaude/tasks/README.md`. Verify with `pnpm install --frozen-lockfile`,
> a companion build, and `pnpm pack:check`.
