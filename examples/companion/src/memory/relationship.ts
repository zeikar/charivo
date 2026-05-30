/**
 * Deterministic relationship-state computation.
 *
 * All functions are PURE: no clock reads, no I/O. The clock is injected as `now`.
 * This state is held by the app and NEVER written by the model — intentionally
 * separate from the fact pipeline to avoid drift.
 */

import type { Transcript, RelationshipSignals } from "./promotion-types";
import type { RelationshipState, MemoryScope } from "./types";

// ---------------------------------------------------------------------------
// Lexical marker sets
// MVP conservative heuristic: case-insensitive substring matching.
// Each user turn contributes at most +1 to the relevant counter (per-turn, not
// per-hit), so a single "thank you so much, thanks!" is counted once positive.
// ---------------------------------------------------------------------------

const POSITIVE_MARKERS = [
  "thank",
  "thanks",
  "awesome",
  "great",
  "love",
  "appreciate",
  "nice",
];

const NEGATIVE_MARKERS = [
  "hate",
  "angry",
  "terrible",
  "awful",
  "stupid",
  "annoying",
  "worst",
];

// Address style markers — presence of either set wins; if both appear the tie
// is broken by whichever set has more markers present; if still tied → undefined.
const CASUAL_MARKERS = ["hey", "yo", "lol", "gonna", "wanna"];
const FORMAL_MARKERS = ["sir", "madam", "please advise", "regards"];

function containsAny(text: string, markers: string[]): boolean {
  const lower = text.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

function countMatches(text: string, markers: string[]): number {
  const lower = text.toLowerCase();
  return markers.filter((m) => lower.includes(m)).length;
}

/**
 * Derive observable signals from a transcript.
 * Operates purely on turn data — no model calls, no I/O.
 */
export function deriveRelationshipSignals(
  transcript: Transcript,
): RelationshipSignals {
  const userTurns = transcript.turns.filter((t) => t.role === "user");

  let positiveSignals = 0;
  let negativeSignals = 0;
  let casualHits = 0;
  let formalHits = 0;

  for (const turn of userTurns) {
    if (containsAny(turn.text, POSITIVE_MARKERS)) positiveSignals++;
    if (containsAny(turn.text, NEGATIVE_MARKERS)) negativeSignals++;
    casualHits += countMatches(turn.text, CASUAL_MARKERS);
    formalHits += countMatches(turn.text, FORMAL_MARKERS);
  }

  // Address style: more marker hits wins. Tie (including both zero) → undefined.
  let addressStyleHint: RelationshipSignals["addressStyleHint"];
  if (casualHits > formalHits) addressStyleHint = "casual";
  else if (formalHits > casualHits) addressStyleHint = "formal";
  // else: tied or neither → leave undefined

  return {
    userTurnCount: userTurns.length,
    positiveSignals,
    negativeSignals,
    addressStyleHint,
  };
}

// ---------------------------------------------------------------------------
// Rapport update constants
// RAPPORT_STEP: each net signal unit moves rapport by this amount.
// Result is clamped to [-1, 1] after applying the full delta.
// ---------------------------------------------------------------------------

const RAPPORT_STEP = 0.05;

/**
 * Advance relationship state deterministically from signals.
 *
 * Param order is fixed: `(prev, signals, scope, now)` — Task 6 `finalizeSession`
 * calls this as a reduce argument with that exact shape.
 */
export function updateRelationship(
  prev: RelationshipState | null,
  signals: RelationshipSignals,
  scope: MemoryScope,
  now: number,
): RelationshipState {
  const sessionCount = (prev?.sessionCount ?? 0) + 1;
  const lastSeenAt = now;

  // Rapport: bounded step per net signal, result clamped to [-1, 1].
  const baseRapport = prev?.rapport ?? 0;
  const delta =
    RAPPORT_STEP * (signals.positiveSignals - signals.negativeSignals);
  const rapport = Math.min(1, Math.max(-1, baseRapport + delta));

  const addressStyle =
    signals.addressStyleHint ?? prev?.addressStyle ?? "unknown";

  // Carry forward existing flags then apply any new observations.
  const flags: Record<string, boolean> = { ...(prev?.flags ?? {}) };
  // Track whether the user has ever sent a positive signal in any session.
  if (signals.positiveSignals > 0) flags.has_been_thanked = true;

  return { scope, rapport, sessionCount, lastSeenAt, addressStyle, flags };
}
