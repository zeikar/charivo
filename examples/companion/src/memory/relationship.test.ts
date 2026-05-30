import { describe, it, expect } from "vitest";

import { deriveRelationshipSignals, updateRelationship } from "./relationship";
import type { Transcript, Turn } from "./promotion-types";
import type { MemoryScope, RelationshipState } from "./types";

// ---------------------------------------------------------------------------
// Fixed clock — deterministic throughout.
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCOPE: MemoryScope = { userId: "user1", characterId: "char1" };

function makeTurn(
  id: string,
  role: "user" | "assistant",
  text: string,
  at = NOW,
): Turn {
  return { id, role, text, at };
}

function makeTranscript(turns: Turn[]): Transcript {
  return {
    sessionId: "session-1",
    scope: SCOPE,
    startedAt: NOW - 60_000,
    endedAt: NOW,
    turns,
  };
}

// ---------------------------------------------------------------------------
// updateRelationship — first-ever call (prev = null)
// ---------------------------------------------------------------------------

describe("updateRelationship — first update (prev = null)", () => {
  it("sessionCount is 1, lastSeenAt is now", () => {
    const signals = {
      userTurnCount: 0,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);

    expect(state.sessionCount).toBe(1);
    expect(state.lastSeenAt).toBe(NOW);
  });

  it("addressStyle comes from addressStyleHint when provided", () => {
    const signals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
      addressStyleHint: "casual" as const,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);
    expect(state.addressStyle).toBe("casual");
  });

  it("addressStyle defaults to 'unknown' when no hint and no prev", () => {
    const signals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);
    expect(state.addressStyle).toBe("unknown");
  });

  it("rapport reflects 2 positive, 0 negative signals → 0.10", () => {
    const signals = {
      userTurnCount: 2,
      positiveSignals: 2,
      negativeSignals: 0,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);
    // 0 + 0.05 * (2 - 0) = 0.10
    expect(state.rapport).toBeCloseTo(0.1, 10);
  });

  it("scope is set from the passed scope argument", () => {
    const signals = {
      userTurnCount: 0,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);
    expect(state.scope).toEqual(SCOPE);
  });
});

// ---------------------------------------------------------------------------
// updateRelationship — second update (pass prior result as prev)
// ---------------------------------------------------------------------------

describe("updateRelationship — second update (prev != null)", () => {
  it("sessionCount increments to 2", () => {
    const signals = {
      userTurnCount: 1,
      positiveSignals: 1,
      negativeSignals: 0,
    };
    const first = updateRelationship(null, signals, SCOPE, NOW);
    const second = updateRelationship(first, signals, SCOPE, NOW + 1000);

    expect(second.sessionCount).toBe(2);
  });

  it("rapport nudges by the bounded step from prior value", () => {
    const signalsPos = {
      userTurnCount: 2,
      positiveSignals: 2,
      negativeSignals: 0,
    };
    const first = updateRelationship(null, signalsPos, SCOPE, NOW);
    // After first: rapport = 0.10
    expect(first.rapport).toBeCloseTo(0.1, 10);

    const second = updateRelationship(first, signalsPos, SCOPE, NOW + 1000);
    // After second: 0.10 + 0.05 * (2 - 0) = 0.20
    expect(second.rapport).toBeCloseTo(0.2, 10);
  });

  it("many positive signals clamp rapport at 1", () => {
    let state: RelationshipState | null = null;
    const signals = {
      userTurnCount: 10,
      positiveSignals: 10,
      negativeSignals: 0,
    };
    // 1 / 0.05 = 20 steps needed to reach 1; run 30 iterations to be sure
    for (let i = 0; i < 30; i++) {
      state = updateRelationship(state, signals, SCOPE, NOW + i * 1000);
    }
    expect(state!.rapport).toBeLessThanOrEqual(1);
    expect(state!.rapport).toBeCloseTo(1, 5);
  });

  it("has_been_thanked flag set in update 1 persists in update 2 with no positives", () => {
    const signalsPos = {
      userTurnCount: 1,
      positiveSignals: 1,
      negativeSignals: 0,
    };
    const first = updateRelationship(null, signalsPos, SCOPE, NOW);
    expect(first.flags.has_been_thanked).toBe(true);

    const signalsNeutral = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 0,
    };
    const second = updateRelationship(first, signalsNeutral, SCOPE, NOW + 1000);
    // Flag must carry forward even though update 2 has no positives.
    expect(second.flags.has_been_thanked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateRelationship — net-negative signals
// ---------------------------------------------------------------------------

describe("updateRelationship — net-negative signals", () => {
  it("net negative signals decrease rapport", () => {
    const signals = {
      userTurnCount: 1,
      positiveSignals: 0,
      negativeSignals: 2,
    };
    const state = updateRelationship(null, signals, SCOPE, NOW);
    // 0 + 0.05 * (0 - 2) = -0.10
    expect(state.rapport).toBeCloseTo(-0.1, 10);
  });

  it("many negative signals clamp rapport at -1", () => {
    let state: RelationshipState | null = null;
    const signals = {
      userTurnCount: 10,
      positiveSignals: 0,
      negativeSignals: 10,
    };
    for (let i = 0; i < 30; i++) {
      state = updateRelationship(state, signals, SCOPE, NOW + i * 1000);
    }
    expect(state!.rapport).toBeGreaterThanOrEqual(-1);
    expect(state!.rapport).toBeCloseTo(-1, 5);
  });
});

// ---------------------------------------------------------------------------
// deriveRelationshipSignals — unit tests on hand-built transcripts
// ---------------------------------------------------------------------------

describe("deriveRelationshipSignals", () => {
  it("counts only user turns for userTurnCount", () => {
    const transcript = makeTranscript([
      makeTurn("t1", "user", "hello"),
      makeTurn("t2", "assistant", "hi there"),
      makeTurn("t3", "user", "thanks a lot"),
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.userTurnCount).toBe(2);
  });

  it("tallies positive signals per-turn (one hit per turn, not per keyword)", () => {
    const transcript = makeTranscript([
      // two positive keywords in one turn → still counts as +1
      makeTurn("t1", "user", "thank you so much, appreciate it!"),
      makeTurn("t2", "user", "that's awesome"),
      makeTurn("t3", "assistant", "great job"), // assistant → not counted
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.positiveSignals).toBe(2);
    expect(signals.negativeSignals).toBe(0);
  });

  it("tallies negative signals correctly", () => {
    const transcript = makeTranscript([
      makeTurn("t1", "user", "this is terrible and awful"),
      makeTurn("t2", "user", "you're stupid"),
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.negativeSignals).toBe(2);
  });

  it("infers 'casual' addressStyleHint from casual markers", () => {
    const transcript = makeTranscript([
      makeTurn("t1", "user", "hey, what's up? lol"),
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.addressStyleHint).toBe("casual");
  });

  it("infers 'formal' addressStyleHint from formal markers", () => {
    const transcript = makeTranscript([
      makeTurn("t1", "user", "sir, please advise on this matter"),
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.addressStyleHint).toBe("formal");
  });

  it("addressStyleHint is undefined when neither style appears", () => {
    const transcript = makeTranscript([
      makeTurn("t1", "user", "what time is it?"),
    ]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.addressStyleHint).toBeUndefined();
  });

  it("returns zero counts and no hint for an empty transcript", () => {
    const transcript = makeTranscript([]);
    const signals = deriveRelationshipSignals(transcript);
    expect(signals.userTurnCount).toBe(0);
    expect(signals.positiveSignals).toBe(0);
    expect(signals.negativeSignals).toBe(0);
    expect(signals.addressStyleHint).toBeUndefined();
  });
});
