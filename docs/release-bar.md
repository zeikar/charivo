# Release Bar (Phase 5)

Recorded: 2026-06-04

The minimum operating bar a release decision is checked against — the "is it
good and safe enough to ship?" gate. This is distinct from
[release-checklist.md](release-checklist.md), which is the packaging/publishing
hygiene checklist (verify, changesets, versioning, docs). Use both: the bar
decides _whether_ to release; the checklist governs _how_ to publish.

Closes the Phase 5 exit criterion in [ROADMAP.md](history/ROADMAP.md): release
decisions can now be justified against explicit criteria.

## Release scopes

- **Demo / showcase** — the public Vercel demo (`examples/companion`,
  `examples/web`). Non-commercial, attribution-only. This is the current
  posture.
- **Productized / commercial release** — shipping Charivo, or a companion built
  on it, as a product. Adds commercial-use and redistribution obligations and a
  higher reliability bar.

The bar below is the floor for a demo/showcase release. A productized or
commercial release must additionally complete the IP / asset / voice review
called out under "IP / asset / voice risk" below.

## The bar

A release is justified only when every item below holds, or an item is
explicitly waived in writing with its rationale and the scope the waiver covers.

### Reliability — regressions are detectable and none are open

- **Memory precision** — the precision-first memory eval passes its thresholds.
  Run on demand at release time: `pnpm --filter companion eval:memory` is green.
  Source of truth: [history/memory-eval-2026-05.md](history/memory-eval-2026-05.md)
  and the thresholds under `examples/companion/src/eval`.
- **Tool misuse** — the Tier-1 deterministic gate (available-tool wiring +
  handler arg-validity + narration-leakage classifier) is green in CI. It runs
  as regular `*.test.ts`, so the bar is `pnpm verify` green.
  Source: [history/avatar-tool-misuse-eval-2026-06.md](history/avatar-tool-misuse-eval-2026-06.md).
- **Latency + interruption** — response-start latency and interruption /
  reconnect behavior stay within the Phase 0 envelope. The bar is re-recorded
  numbers that do not regress beyond the stated envelope.
  Source: [baseline.md](baseline.md).
- **Persona consistency** — the advisory persona eval has been run and reviewed
  for the release candidate with no unresolved persona regression. This eval is
  advisory (Claude-as-judge, not a hard numeric gate), so the bar is a reviewed
  judgment rather than a pass/fail number.
  Source: [history/persona-eval-2026-06.md](history/persona-eval-2026-06.md).

### Build / publish hygiene

- [release-checklist.md](release-checklist.md) passes: `pnpm verify`,
  `pnpm pack:check`, changeset correctness, and docs accuracy.

### IP / asset / voice risk

- Voices are OpenAI built-in synthetic identities (`marin`, `sage`) — not clones
  of any real person, so voice-similarity risk is low.
- Bundled models are attributed in the companion
  [README Credits](../examples/companion/README.md); the vendored Live2D Cubism
  SDK ships its own license (see the root README "Live2D Note").
- A full IP / asset-licensing review — resolving the Live2D Free Material, Booth,
  and OpenAI usage-policy terms for the specific release — is a **precondition of
  any public or commercial release**, done at that decision point. It is not
  required for the current non-commercial, attributed demo.

## Decision rule

Meet every bar → a release is justified for the stated scope. Any unmet bar →
fix it, or waive it in writing with the rationale and the scope the waiver
applies to. Do not ship a productized or commercial build while an item in the
IP / asset / voice review is still open.
