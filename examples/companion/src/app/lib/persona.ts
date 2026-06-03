/**
 * App-layer structured-persona augmentation (invariants + character-specific state hooks).
 * Extraction-ready but NOT pushed to @charivo/*. The persona hook keys off p4-02's
 * classifyRelationship buckets and COMPLEMENTS (never duplicates) p4-02's character-agnostic
 * DIRECTIVE guidance.
 */

import {
  classifyRelationship,
  type RapportBucket,
  type CadenceBucket,
} from "../../memory/relationship-guidance";
import type { RelationshipState } from "../../memory/types";
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import type { Character } from "@charivo/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The closed set of bucket keys a persona state hook may target.
 * Mirrors the p4-02 classifyRelationship bucket values that carry
 * character-specific flavour.
 */
export type PersonaHookKey =
  | "rapport:low"
  | "rapport:warm"
  | "cadence:early"
  | "cadence:returning-after-gap";

/**
 * Structured per-character persona definition.
 * - `invariants` — always-on core voice and values; injected on every turn.
 * - `stateHooks` — per-character flavour per relationship bucket; injected only
 *   when the bucket applies and the hook is defined. Complements (never
 *   duplicates) the character-agnostic DIRECTIVE guidance from p4-02.
 */
export interface StructuredPersona {
  /** Always-on identity anchors: voice description and stated values. */
  invariants: {
    /** One-line description of the character's vocal and conversational style. */
    voice: string;
    /** Commitments the character always upholds, regardless of relationship state. */
    values: string[];
  };
  /**
   * Per-bucket character-specific flavour strings. Each key corresponds to a
   * PersonaHookKey bucket. Only DEFINED entries are candidates; undefined keys
   * are skipped. Complements (never duplicates) the p4-02 DIRECTIVE table.
   */
  stateHooks: Partial<Record<PersonaHookKey, string>>;
}

// ---------------------------------------------------------------------------
// Pure selector
// ---------------------------------------------------------------------------

/**
 * Select at most one hook string from a persona's stateHooks based on the
 * current relationship buckets.
 *
 * Priority order (highest to lowest):
 *   1. cadence:returning-after-gap
 *   2. cadence:early
 *   3. rapport:low
 *   4. rapport:warm
 *
 * First-meeting guard: cadence === "first-meeting" → always returns null,
 * before any candidate is evaluated (mirrors selectDirectiveIds's <= 0 guard).
 *
 * Skip-to-next-DEFINED: if the highest-priority matched candidate has no
 * defined hook, fall through to the next defined one. Returns null only when
 * none of the matched candidates is defined.
 *
 * Neutral rapport / established cadence contribute no candidate key.
 */
export function selectPersonaHook(
  persona: StructuredPersona,
  buckets: { rapport: RapportBucket; cadence: CadenceBucket },
): string | null {
  // First-meeting guard: no relationship history → no hook.
  if (buckets.cadence === "first-meeting") return null;

  // Build ordered candidate keys matching the current buckets.
  const candidates: PersonaHookKey[] = [];

  if (buckets.cadence === "returning-after-gap") {
    candidates.push("cadence:returning-after-gap");
  }
  if (buckets.cadence === "early") {
    candidates.push("cadence:early");
  }
  if (buckets.rapport === "low") {
    candidates.push("rapport:low");
  }
  if (buckets.rapport === "warm") {
    candidates.push("rapport:warm");
  }

  // Return the first defined hook, skipping undefined entries.
  for (const key of candidates) {
    const hook = persona.stateHooks[key];
    if (hook !== undefined) return hook;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pure renderer
// ---------------------------------------------------------------------------

/**
 * Render the full instruction string for a character, augmented with structured
 * persona invariants and a state hook when applicable.
 *
 * PURE: no clock reads, no I/O, no React. ctx.now is injected by the caller.
 *
 * Fallback: characters without a `persona` field return `base` unchanged —
 * zero regression for existing entries.
 */
export function renderPersonaInstructions(
  character: Character & { persona?: StructuredPersona },
  state: RelationshipState | null,
  ctx: { now: number },
): string {
  const base = buildRealtimeSessionConfig({ character }).instructions ?? "";

  if (!character.persona) return base;

  const { invariants } = character.persona;

  const segments: string[] = [base];

  // Always-on invariant lines.
  segments.push(
    `Core voice (always, regardless of how well you know them): ${invariants.voice}`,
  );
  segments.push(`You always: ${invariants.values.join("; ")}`);

  // State hook — only when there is relationship history and the selector fires.
  if (state !== null) {
    const hook = selectPersonaHook(
      character.persona,
      classifyRelationship(state, ctx),
    );
    if (hook !== null) {
      segments.push(`Right now: ${hook}`);
    }
  }

  // Filter empty segments to avoid blank lines (matches render-memory.ts idiom).
  return segments.filter(Boolean).join("\n");
}
