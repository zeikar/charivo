/**
 * Deterministic scenario fixtures for the persona hook eval harness.
 *
 * Purpose: declare the four RelationshipState inputs (Hiyori/Yuki × low/warm)
 * and the two neutral user turns that the capture module drives through the
 * live LLM to produce persona-hook-differentiated samples.
 *
 * Fixed-NOW determinism applies to the PROMPT side only (the relationship-bucket
 * classification is deterministic given NOW); LLM generation is non-deterministic.
 *
 * Hook strings are NOT copied here — the capture module reads them lazily off
 * the live character catalog (getCharacterById) so a catalog edit is immediately
 * reflected in the harness.
 */

import {
  classifyRelationship,
  EARLY_RETURNING_MAX,
} from "../../../memory/relationship-guidance";
import type { RelationshipState } from "../../../memory/types";
import type { PersonaHookKey } from "../../../app/lib/persona";

// ---------------------------------------------------------------------------
// Deterministic time anchor
// ---------------------------------------------------------------------------

/** Fixed epoch-ms anchor — same value used by persona-state-composition.test.ts. */
export const NOW = 1_700_000_000_000;

// lastSeenAt == NOW → gap = 0 ms, well under STALE_AFTER_MS (14 days)
// → cadence bucket = "established" for sessionCount > EARLY_RETURNING_MAX (1)
const RECENT_LAST_SEEN = NOW;

// ---------------------------------------------------------------------------
// RelationshipState factory
// ---------------------------------------------------------------------------

/**
 * Build a RelationshipState for a given characterId with sensible eval defaults.
 * Default sessionCount is EARLY_RETURNING_MAX + 2: strictly past the early
 * boundary, so cadence = "established" when lastSeenAt is recent.
 */
function makeState(
  characterId: string,
  overrides: Partial<Omit<RelationshipState, "scope">>,
): RelationshipState {
  return {
    scope: { userId: "eval-user", characterId },
    rapport: 0,
    sessionCount: EARLY_RETURNING_MAX + 2,
    lastSeenAt: RECENT_LAST_SEEN,
    addressStyle: "casual",
    flags: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario states
// ---------------------------------------------------------------------------

const hiyoriLowState = makeState("companion-default", { rapport: -0.8 });
const hiyoriWarmState = makeState("companion-default", { rapport: 0.8 });
const yukiLowState = makeState("companion-genki", { rapport: -0.8 });
const yukiWarmState = makeState("companion-genki", { rapport: 0.8 });

// ---------------------------------------------------------------------------
// User turns
// ---------------------------------------------------------------------------

/**
 * Two neutral, persona-revealing prompts. They surface emotional tone without
 * dictating the character's response register — low vs warm hooks must come from
 * the persona, not from a prompt that names the expected emotion.
 */
export const USER_TURNS: string[] = [
  "How was your day?",
  "I had kind of a rough week.",
];

// ---------------------------------------------------------------------------
// Scenario array
// ---------------------------------------------------------------------------

export interface PersonaScenario {
  id: string;
  characterId: string;
  bucketLabel: "low" | "warm";
  expectedHookKey: PersonaHookKey;
  state: RelationshipState;
}

export const PERSONA_SCENARIOS: PersonaScenario[] = [
  {
    id: "hiyori-low",
    characterId: "companion-default",
    bucketLabel: "low",
    expectedHookKey: "rapport:low",
    state: hiyoriLowState,
  },
  {
    id: "hiyori-warm",
    characterId: "companion-default",
    bucketLabel: "warm",
    expectedHookKey: "rapport:warm",
    state: hiyoriWarmState,
  },
  {
    id: "yuki-low",
    characterId: "companion-genki",
    bucketLabel: "low",
    expectedHookKey: "rapport:low",
    state: yukiLowState,
  },
  {
    id: "yuki-warm",
    characterId: "companion-genki",
    bucketLabel: "warm",
    expectedHookKey: "rapport:warm",
    state: yukiWarmState,
  },
];

// ---------------------------------------------------------------------------
// Character pair sets (low vs warm side-by-side per character)
// ---------------------------------------------------------------------------

export const PAIR_SETS: Array<{
  characterId: string;
  lowScenarioId: string;
  warmScenarioId: string;
}> = [
  {
    characterId: "companion-default",
    lowScenarioId: "hiyori-low",
    warmScenarioId: "hiyori-warm",
  },
  {
    characterId: "companion-genki",
    lowScenarioId: "yuki-low",
    warmScenarioId: "yuki-warm",
  },
];

// ---------------------------------------------------------------------------
// Runtime validation (NOT called at module scope — invoke on the enabled path only)
// ---------------------------------------------------------------------------

/**
 * Validate that each scenario's relationship state actually resolves to the
 * expected rapport/cadence buckets at NOW.
 *
 * Call this from the capture module on the ENABLED path. Never invoke at
 * module scope — the suite may be imported during a disabled (no-key) run and
 * a top-level throw would prevent the clean skip.
 */
export function validateScenarioBuckets(): void {
  for (const scenario of PERSONA_SCENARIOS) {
    const { rapport, cadence } = classifyRelationship(scenario.state, {
      now: NOW,
    });

    if (rapport !== scenario.bucketLabel) {
      throw new Error(
        `Scenario "${scenario.id}": expected rapport bucket "${scenario.bucketLabel}" but got "${rapport}"`,
      );
    }
    if (cadence !== "established") {
      throw new Error(
        `Scenario "${scenario.id}": expected cadence "established" but got "${cadence}"`,
      );
    }
  }
}
