/**
 * Relationship guidance: translates RelationshipState into behavioural directives
 * that the compose layer injects into the system prompt.
 *
 * This is GUIDANCE about memory USE and relationship tone — NOT fact retrieval.
 * Time-of-day / situational context lives in src/app/lib/situational-context.ts,
 * NOT here.
 *
 * All functions are PURE: no clock reads, no I/O. The clock is injected as ctx.now.
 */

import type { RelationshipState } from "./types";

// ---------------------------------------------------------------------------
// Policy: threshold constants
// ±0.3 bucketing matches the descriptor in render-memory.ts renderRelationshipBlock.
// ---------------------------------------------------------------------------

export const RAPPORT_WARM_MIN = 0.3;
export const RAPPORT_STRAINED_MAX = -0.3;
/** 14 days in milliseconds. */
export const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A user with sessionCount <= EARLY_RETURNING_MAX is an early returning user.
 * First meeting (sessionCount <= 0) is handled separately — selectDirectiveIds
 * returns [] immediately so it never reaches the bucket logic.
 */
export const EARLY_RETURNING_MAX = 1;

// ---------------------------------------------------------------------------
// Policy: directive copy table
// ---------------------------------------------------------------------------

export const DIRECTIVE = {
  rapport_low_restraint:
    "Keep some distance — don't volunteer remembered details unprompted, and let warmth build gradually rather than assuming closeness.",
  rapport_high_proactive_recall:
    "You're close — it's natural to bring up things you remember about them and speak warmly and familiarly.",
  cadence_early_no_intimacy:
    "You're still getting to know each other — be friendly, but don't act like an old friend or assume intimacy you haven't earned yet.",
  cadence_returning_after_gap:
    "It's been a while since you last spoke — you may gently acknowledge the gap rather than continuing as if no time had passed.",
  restraint_no_overrecall:
    "Don't lean too hard on any single remembered detail or repeat it — reference memory lightly, and only when it fits.",
  uncertainty_hedge:
    "When you're unsure about something you think you remember, hedge and check with them instead of stating it as fact.",
} as const;

export type DirectiveId = keyof typeof DIRECTIVE;

// ---------------------------------------------------------------------------
// Mechanism: pure selector — no clock read inside
// ---------------------------------------------------------------------------

/**
 * Select the directive IDs that apply to the current relationship state.
 *
 * Returns [] for a first meeting (sessionCount <= 0): no relationship directives
 * apply before any history exists.
 *
 * ctx.now (epoch-ms) is required so gap guidance is never silently skipped.
 * Nothing reads the clock internally — the caller threads now in.
 */
export function selectDirectiveIds(
  state: RelationshipState,
  ctx: { now: number },
): DirectiveId[] {
  // First meeting: no relationship directives.
  if (state.sessionCount <= 0) return [];

  const ids: DirectiveId[] = [];

  // Rapport axis.
  if (state.rapport < RAPPORT_STRAINED_MAX) {
    ids.push("rapport_low_restraint");
  } else if (
    state.rapport > RAPPORT_WARM_MIN &&
    state.sessionCount > EARLY_RETURNING_MAX
  ) {
    // Prohibited-overreaction invariant: never emit proactive recall for early
    // returning users (sessionCount <= EARLY_RETURNING_MAX) even if rapport is
    // already high — they haven't earned that familiarity yet.
    ids.push("rapport_high_proactive_recall");
  }

  // Cadence axis.
  if (state.sessionCount <= EARLY_RETURNING_MAX) {
    ids.push("cadence_early_no_intimacy");
  } else if (ctx.now - state.lastSeenAt > STALE_AFTER_MS) {
    ids.push("cadence_returning_after_gap");
  }

  // Always-on directives.
  ids.push("restraint_no_overrecall");
  ids.push("uncertainty_hedge");

  return ids;
}

// ---------------------------------------------------------------------------
// Mechanism: render selected directive IDs to a guidance block
// ---------------------------------------------------------------------------

/**
 * Join the approved copy lines for the given directive IDs.
 * Returns "" when ids is empty.
 */
export function renderGuidanceFromIds(ids: DirectiveId[]): string {
  return ids.map((id) => DIRECTIVE[id]).join("\n");
}
