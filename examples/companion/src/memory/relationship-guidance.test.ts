import { describe, it, expect } from "vitest";

import {
  EARLY_RETURNING_MAX,
  RAPPORT_STRAINED_MAX,
  RAPPORT_WARM_MIN,
  STALE_AFTER_MS,
  selectDirectiveIds,
} from "./relationship-guidance";
import type { DirectiveId } from "./relationship-guidance";
import type { RelationshipState } from "./types";

// ---------------------------------------------------------------------------
// Fixed clock — never call Date.now() in assertions
// ---------------------------------------------------------------------------

const NOW = new Date(2026, 5, 3, 14, 5).getTime();

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SCOPE = { userId: "u1", characterId: "c1" };

function makeState(overrides: Partial<RelationshipState>): RelationshipState {
  return {
    scope: SCOPE,
    rapport: 0.0,
    sessionCount: 2,
    lastSeenAt: NOW,
    addressStyle: "casual",
    flags: {},
    ...overrides,
  };
}

// Typed directive IDs — annotating as DirectiveId means a rename in the
// DIRECTIVE map breaks these at compile time, so the exclusion assertions
// below cannot pass vacuously against a renamed (ghost) key.
const EARLY: DirectiveId = "cadence_early_no_intimacy";
const HIGH: DirectiveId = "rapport_high_proactive_recall";
const LOW: DirectiveId = "rapport_low_restraint";
const RESTRAINT: DirectiveId = "restraint_no_overrecall";
const HEDGE: DirectiveId = "uncertainty_hedge";
const GAP: DirectiveId = "cadence_returning_after_gap";

// ---------------------------------------------------------------------------
// selectDirectiveIds
// ---------------------------------------------------------------------------

describe("selectDirectiveIds", () => {
  it("returns [] when sessionCount === 0 (self-guard)", () => {
    const state = makeState({ sessionCount: 0 });
    expect(selectDirectiveIds(state, { now: NOW })).toEqual([]);
  });

  it("returns [] when sessionCount < 0 (self-guard)", () => {
    const state = makeState({ sessionCount: -3 });
    expect(selectDirectiveIds(state, { now: NOW })).toEqual([]);
  });

  it("sessionCount === 1 → contains cadence_early_no_intimacy, excludes rapport_high_proactive_recall", () => {
    const state = makeState({ sessionCount: 1, rapport: 0.5 });
    const ids = selectDirectiveIds(state, { now: NOW });
    expect(ids).toContain(EARLY);
    expect(ids).not.toContain(HIGH);
  });

  it("low rapport with sessionCount > 1 → contains rapport_low_restraint, excludes rapport_high_proactive_recall", () => {
    const state = makeState({
      rapport: RAPPORT_STRAINED_MAX - 0.2,
      sessionCount: 3,
    });
    const ids = selectDirectiveIds(state, { now: NOW });
    expect(ids).toContain(LOW);
    expect(ids).not.toContain(HIGH);
  });

  it("high rapport with sessionCount > EARLY_RETURNING_MAX → contains rapport_high_proactive_recall, restraint_no_overrecall, uncertainty_hedge", () => {
    const state = makeState({
      rapport: RAPPORT_WARM_MIN + 0.2,
      sessionCount: EARLY_RETURNING_MAX + 4,
    });
    const ids = selectDirectiveIds(state, { now: NOW });
    expect(ids).toContain(HIGH);
    expect(ids).toContain(RESTRAINT);
    expect(ids).toContain(HEDGE);
  });

  describe("exact-boundary rapport thresholds", () => {
    it("rapport === RAPPORT_WARM_MIN (0.3) with sessionCount > EARLY_RETURNING_MAX → excludes rapport_high_proactive_recall", () => {
      // Selector is strict (>), so the boundary value itself is neutral — no HIGH directive.
      const state = makeState({
        rapport: RAPPORT_WARM_MIN,
        sessionCount: EARLY_RETURNING_MAX + 2,
      });
      const ids = selectDirectiveIds(state, { now: NOW });
      expect(ids).not.toContain(HIGH);
    });

    it("rapport === RAPPORT_STRAINED_MAX (-0.3) with sessionCount > 1 → excludes rapport_low_restraint", () => {
      // Selector is strict (<), so the boundary value itself is neutral — no LOW directive.
      const state = makeState({
        rapport: RAPPORT_STRAINED_MAX,
        sessionCount: 3,
      });
      const ids = selectDirectiveIds(state, { now: NOW });
      expect(ids).not.toContain(LOW);
    });
  });

  describe("cadence-gap determinism", () => {
    it("ctx.now provided, lastSeenAt far enough back → contains cadence_returning_after_gap", () => {
      const state = makeState({
        sessionCount: 5,
        rapport: 0.0,
        lastSeenAt: NOW - STALE_AFTER_MS - 1,
      });
      const ids = selectDirectiveIds(state, { now: NOW });
      expect(ids).toContain(GAP);
    });

    it("ctx.now provided, lastSeenAt is NOW → excludes cadence_returning_after_gap", () => {
      const state = makeState({
        sessionCount: 5,
        rapport: 0.0,
        lastSeenAt: NOW,
      });
      const ids = selectDirectiveIds(state, { now: NOW });
      expect(ids).not.toContain(GAP);
    });
  });
});
