# Phase 3 Memory — Subtask Backlog

> **⚠️ DELETE BEFORE MERGING TO MAIN.** `.hyperclaude/` is normally gitignored.
> The `tasks/` backlog and the two Phase 3 `research/*.md` files were
> force-added to the `hyper/scaffold-a-new-examplescompanion-nextjs` branch only
> to carry Phase 3 context across machines. Before merging to `main`, run:
> `git rm -r .hyperclaude/tasks .hyperclaude/research && git commit`.
> Durable design decisions live in `ROADMAP.md` (Phase 3), which is tracked.

Cross-session memory for `examples/companion`, built in the app/server layer,
**extraction-ready** toward a future `@charivo/memory`. Run **one subtask at a
time** via `/hyperclaude:hyper-auto` (plan-loop → implement-loop), in order —
each depends on the ones above it.

- Research: `.hyperclaude/research/20260529-1319-charivo-live2d-phase-3-prior.md`
  (+ `-claude.md` — same `slug`)
- Decisions: `ROADMAP.md` → Phase 3 → "Decisions" + "Design decisions (2026-05-29)"

## Fixed constraints (apply to EVERY subtask — do not re-litigate)

- **App/server layer only.** No changes to `@charivo/*` core packages or the
  realtime seam. Memory lives in `examples/companion`.
- **Injection seam:** retrieved memory is composed into
  `startSession({ instructions })` (where persona/avatar guidance is already
  assembled) and optionally refreshed via `updateSession(...)`. The model
  **never** writes long-term memory directly — writes happen app-side.
- **Scope key = `userId + characterId`** on every record. MVP = single local
  user, no auth (`userId` is a local placeholder).
- **Extraction-ready boundary:** keep the generic *mechanism* (`MemoryStore`,
  retrieval scoring, supersede/invalidate) separable from *product policy*
  (extraction prompts, salience thresholds, `renderMemoryBlock`, relationship
  rules). Only the mechanism graduates to `@charivo/memory` later.
- **`companion` is in the changeset `ignore` list** — never published; no
  changeset entries for companion-only changes.
- **Precision-first:** conservative extraction / merge / injection.
- Tests must be **deterministic** — stub the LLM extractor and the embedder
  (fakes), no live API calls in `pnpm verify`. Real LLM/embeddings behind a flag.

## Order & status

- [x] `01-scaffold-companion.md` — scaffold the `examples/companion` app + seam ✅ (branch `hyper/scaffold-a-new-examplescompanion-nextjs`)
- [x] `02-memorystore-sqlite.md` — `MemoryStore` interface + SQLite + in-memory vector (mechanism only) ✅ (node:sqlite backend; Codex review clean after fixes; `pnpm verify` 320/320)
- [x] `03-promotion-pipeline.md` — write path: summarize → extract → filter → merge → persist ✅ (9 task commits + 1 code-review fix on branch; Codex code-review clean after 3 fix rounds — same-kind merge scoping + explicit `subject` slot replacing token heuristic; `pnpm verify` green, 111 memory tests)
- [x] `04-retrieval-injection.md` — read path: select within token budget → compose into instructions ✅ (6 task commits + 1 code-review fix; server `/api/memory` route keeps node:sqlite off the client; cold-start + single relevance refresh; injected memory framed as untrusted data; Codex review clean for in-scope; `pnpm verify` green, 140 memory tests. **Follow-ups surfaced:** (a) wire the WRITE path into the live session — promoteSession/scheduler exist but aren't called, so the store is empty until seeded; (b) make `promote.ts` UPDATE atomic (upsertFact+supersede partial-failure))
- [x] `05-correction-deletion.md` — soft-invalidate/supersede + voice "forget that" detection ✅ (4 task commits `f91a8aa`..`b6b8efd` + 1 write-path-hardening fix `e555187`; added `that's wrong`/`that is wrong` retraction markers + precision guard, deterministic forget-that/that's-wrong fixtures, scripted-retraction exclusion tests, README "next-session" note; reused existing replacement coverage — no new channel, the existing `decideMerge` DELETE/UPDATE path consumes correction candidates; Codex code-review clean after 4 fix rounds — all findings were in the earlier write-path wiring, not 05's diff; `pnpm verify` green, 437 tests. **Follow-up surfaced:** failed-final-write retry is a bounded single-slot best-effort, not a durable queue — fine for the MVP demo)
- [ ] `06-eval-harness.md` — Phase 5 seed: deterministic, precision-first memory eval

> **Subtask 04 follow-ups (a)/(b) — RESOLVED** before 05: (a) the WRITE path is now
> wired into the live session (`promoteSession`/scheduler called from
> `useRealtimeSession` via `/api/memory/promote`, with input transcription enabled,
> typed-turn capture, and a durable best-effort final write); (b) `promote.ts` UPDATE
> is atomic via `SqliteMemoryStore.replaceFact` (one BEGIN…COMMIT). Commits
> `bf07e95` (atomic replaceFact) + write-path-wiring commit + `e555187` (hardening).

Mark `[x]` here as each lands. After each subtask, run `pnpm verify` and (if a
publishable package changed — it should not for companion-only work) check
`pnpm pack:check`.
