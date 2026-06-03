import { describe, it, expect } from "vitest";

import {
  classifyRelationship,
  RAPPORT_STRAINED_MAX,
  RAPPORT_WARM_MIN,
  EARLY_RETURNING_MAX,
  STALE_AFTER_MS,
} from "../../memory/relationship-guidance";
import type { RelationshipState } from "../../memory/types";
import { selectPersonaHook, renderPersonaInstructions } from "./persona";
import type { StructuredPersona } from "./persona";
import { getCharacterById } from "./character-catalog";
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import type { Character } from "@charivo/core";

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

// ---------------------------------------------------------------------------
// classifyRelationship
// ---------------------------------------------------------------------------

describe("classifyRelationship", () => {
  describe("rapport bucket", () => {
    it("rapport < RAPPORT_STRAINED_MAX → low", () => {
      const state = makeState({ rapport: RAPPORT_STRAINED_MAX - 0.01 });
      expect(classifyRelationship(state, { now: NOW }).rapport).toBe("low");
    });

    it("rapport === RAPPORT_STRAINED_MAX → neutral (strict <, boundary is NOT low)", () => {
      const state = makeState({ rapport: RAPPORT_STRAINED_MAX });
      expect(classifyRelationship(state, { now: NOW }).rapport).toBe("neutral");
    });

    it("rapport between boundaries → neutral", () => {
      const state = makeState({ rapport: 0.0 });
      expect(classifyRelationship(state, { now: NOW }).rapport).toBe("neutral");
    });

    it("rapport === RAPPORT_WARM_MIN → neutral (strict >, boundary is NOT warm)", () => {
      const state = makeState({ rapport: RAPPORT_WARM_MIN });
      expect(classifyRelationship(state, { now: NOW }).rapport).toBe("neutral");
    });

    it("rapport > RAPPORT_WARM_MIN → warm", () => {
      const state = makeState({ rapport: RAPPORT_WARM_MIN + 0.01 });
      expect(classifyRelationship(state, { now: NOW }).rapport).toBe("warm");
    });
  });

  describe("cadence bucket", () => {
    it("sessionCount <= 0 → first-meeting", () => {
      const state = makeState({ sessionCount: 0 });
      expect(classifyRelationship(state, { now: NOW }).cadence).toBe(
        "first-meeting",
      );
    });

    it("sessionCount < 0 → first-meeting", () => {
      const state = makeState({ sessionCount: -1 });
      expect(classifyRelationship(state, { now: NOW }).cadence).toBe(
        "first-meeting",
      );
    });

    it("sessionCount === EARLY_RETURNING_MAX → early", () => {
      const state = makeState({ sessionCount: EARLY_RETURNING_MAX });
      expect(classifyRelationship(state, { now: NOW }).cadence).toBe("early");
    });

    it("gap > STALE_AFTER_MS with sessionCount > EARLY_RETURNING_MAX → returning-after-gap", () => {
      const state = makeState({
        sessionCount: EARLY_RETURNING_MAX + 1,
        lastSeenAt: NOW - STALE_AFTER_MS - 1,
      });
      expect(classifyRelationship(state, { now: NOW }).cadence).toBe(
        "returning-after-gap",
      );
    });

    it("sessionCount > EARLY_RETURNING_MAX, lastSeenAt = NOW → established", () => {
      const state = makeState({
        sessionCount: EARLY_RETURNING_MAX + 2,
        lastSeenAt: NOW,
      });
      expect(classifyRelationship(state, { now: NOW }).cadence).toBe(
        "established",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// selectPersonaHook fixture persona
// ---------------------------------------------------------------------------

const FIXTURE_PERSONA: StructuredPersona = {
  invariants: {
    voice: "fixture voice",
    values: ["fixture value one", "fixture value two"],
  },
  stateHooks: {
    "rapport:low": "hook for rapport low",
    "rapport:warm": "hook for rapport warm",
    "cadence:early": "hook for cadence early",
    "cadence:returning-after-gap": "hook for cadence gap",
  },
};

// ---------------------------------------------------------------------------
// selectPersonaHook
// ---------------------------------------------------------------------------

describe("selectPersonaHook", () => {
  describe("(a) each bucket returns its expected hook", () => {
    it("rapport:low state → rapport:low hook", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "low",
          cadence: "established",
        }),
      ).toBe("hook for rapport low");
    });

    it("rapport:warm state → rapport:warm hook", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "warm",
          cadence: "established",
        }),
      ).toBe("hook for rapport warm");
    });

    it("cadence:early state → cadence:early hook", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "neutral",
          cadence: "early",
        }),
      ).toBe("hook for cadence early");
    });

    it("cadence:returning-after-gap state → gap hook", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "neutral",
          cadence: "returning-after-gap",
        }),
      ).toBe("hook for cadence gap");
    });
  });

  describe("(b) priority: gap outranks rapport:low when both match", () => {
    it("returning-after-gap + rapport:low → returns gap hook", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "low",
          cadence: "returning-after-gap",
        }),
      ).toBe("hook for cadence gap");
    });
  });

  describe("(c) skip-to-next-defined fallback", () => {
    it("gap bucket matched but no gap hook defined → falls through to rapport:low hook", () => {
      const personaWithoutGapHook: StructuredPersona = {
        invariants: FIXTURE_PERSONA.invariants,
        stateHooks: {
          "rapport:low": "hook for rapport low",
          // "cadence:returning-after-gap" intentionally absent
        },
      };
      expect(
        selectPersonaHook(personaWithoutGapHook, {
          rapport: "low",
          cadence: "returning-after-gap",
        }),
      ).toBe("hook for rapport low");
    });
  });

  describe("(d) first-meeting guard suppresses rapport hooks", () => {
    it("cadence === first-meeting with rapport:low hook defined → null", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "low",
          cadence: "first-meeting",
        }),
      ).toBeNull();
    });

    it("cadence === first-meeting with rapport:warm hook defined → null", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "warm",
          cadence: "first-meeting",
        }),
      ).toBeNull();
    });
  });

  describe("(e) null when no matched candidate is defined, and for neutral/established buckets", () => {
    it("neutral rapport + established cadence → null (no candidate keys)", () => {
      expect(
        selectPersonaHook(FIXTURE_PERSONA, {
          rapport: "neutral",
          cadence: "established",
        }),
      ).toBeNull();
    });

    it("all matched candidates undefined in stateHooks → null", () => {
      const emptyHooksPersona: StructuredPersona = {
        invariants: FIXTURE_PERSONA.invariants,
        stateHooks: {},
      };
      expect(
        selectPersonaHook(emptyHooksPersona, {
          rapport: "low",
          cadence: "established",
        }),
      ).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// renderPersonaInstructions — real Hiyori
// ---------------------------------------------------------------------------

const realHiyori = getCharacterById("companion-default");

describe("renderPersonaInstructions — real Hiyori invariants", () => {
  const state = makeState({ sessionCount: 5, rapport: 0.0 });
  const out = renderPersonaInstructions(realHiyori, state, { now: NOW });

  const persona = realHiyori.persona!;

  it("contains base identity substring", () => {
    expect(out).toContain(`You are ${realHiyori.name}.`);
  });

  it("contains voice invariant text", () => {
    expect(out).toContain(persona.invariants.voice);
  });

  it("contains each values entry", () => {
    for (const v of persona.invariants.values) {
      expect(out).toContain(v);
    }
  });
});

// ---------------------------------------------------------------------------
// Ordering test: base before voice invariant
// ---------------------------------------------------------------------------

describe("renderPersonaInstructions — ordering", () => {
  const state = makeState({ sessionCount: 5, rapport: 0.0 });
  const out = renderPersonaInstructions(realHiyori, state, { now: NOW });

  it("base substring appears before voice invariant text", () => {
    const baseSubstring = `You are ${realHiyori.name}.`;
    const voiceText = realHiyori.persona!.invariants.voice;
    expect(out.indexOf(baseSubstring)).toBeLessThan(out.indexOf(voiceText));
  });
});

// ---------------------------------------------------------------------------
// Fallback: character without persona → equals buildRealtimeSessionConfig output
// ---------------------------------------------------------------------------

describe("renderPersonaInstructions — no-persona fallback", () => {
  const fixtureChar: Character & { persona?: never } = {
    id: "test-no-persona",
    name: "TestChar",
    description: "A test character with no persona.",
    personality: "Calm and neutral",
    voice: { voiceId: "alloy", rate: 1.0, pitch: 1.0, volume: 1.0 },
  };

  const state = makeState({ sessionCount: 2 });

  it("equals buildRealtimeSessionConfig instructions exactly", () => {
    const expected =
      buildRealtimeSessionConfig({ character: fixtureChar }).instructions ?? "";
    const actual = renderPersonaInstructions(fixtureChar, state, { now: NOW });
    expect(actual).toBe(expected);
  });
});
