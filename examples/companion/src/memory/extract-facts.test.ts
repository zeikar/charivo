import { describe, it, expect } from "vitest";

import { extractFacts } from "./extract-facts";
import { createScriptedExtractor } from "./__fixtures__/scripted-extractor";
import type { Turn, Transcript, FactCandidate } from "./promotion-types";

// ---------------------------------------------------------------------------
// Fixed clock anchor — keeps tests deterministic.
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Transcript factory helpers
// ---------------------------------------------------------------------------

function makeTranscript(turns: Turn[]): Transcript {
  return {
    sessionId: "session-1",
    scope: { userId: "user-1", characterId: "char-1" },
    startedAt: NOW,
    endedAt: NOW + 60_000,
    turns,
  };
}

function userTurn(id: string): Turn {
  return { id, role: "user", text: "hello", at: NOW };
}

function assistantTurn(id: string): Turn {
  return { id, role: "assistant", text: "hi there", at: NOW + 1_000 };
}

function candidate(
  sourceTurnId: string,
  overrides?: Partial<FactCandidate>,
): FactCandidate {
  return {
    text: `fact from ${sourceTurnId}`,
    kind: "other",
    importance: 0.5,
    sourceTurnId,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractFacts", () => {
  it("keeps user-sourced candidates and drops assistant-sourced ones", async () => {
    const transcript = makeTranscript([
      userTurn("turn-u1"),
      assistantTurn("turn-a1"),
    ]);

    const extractor = createScriptedExtractor({
      "turn-u1": [candidate("turn-u1")],
      "turn-a1": [candidate("turn-a1")],
    });

    const result = await extractFacts(transcript, extractor);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceTurnId).toBe("turn-u1");
    expect(result.droppedCount).toBe(1);
  });

  it("drops candidates whose sourceTurnId does not exist in the transcript", async () => {
    const transcript = makeTranscript([userTurn("turn-u1")]);

    const extractor = createScriptedExtractor({
      "turn-u1": [candidate("turn-u1")],
      "turn-ghost": [candidate("turn-ghost")], // not in transcript
    });

    const result = await extractFacts(transcript, extractor);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceTurnId).toBe("turn-u1");
    expect(result.droppedCount).toBe(1);
  });

  it("drops candidates with importance out of [0, 1]", async () => {
    const transcript = makeTranscript([userTurn("turn-u1")]);

    const extractor = createScriptedExtractor({
      "turn-u1": [
        candidate("turn-u1", { importance: 1.5 }),
        candidate("turn-u1", { importance: -0.1 }),
      ],
    });

    const result = await extractFacts(transcript, extractor);

    expect(result.candidates).toHaveLength(0);
    expect(result.droppedCount).toBe(2);
  });

  it("drops candidates with NaN importance", async () => {
    const transcript = makeTranscript([userTurn("turn-u1")]);

    const extractor = createScriptedExtractor({
      "turn-u1": [candidate("turn-u1", { importance: NaN })],
    });

    const result = await extractFacts(transcript, extractor);

    expect(result.candidates).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  it("passes a valid user-sourced candidate through unchanged with droppedCount 0", async () => {
    const transcript = makeTranscript([userTurn("turn-u1")]);

    const original = candidate("turn-u1", {
      importance: 0.8,
      kind: "preference",
      text: "likes cats",
    });
    const extractor = createScriptedExtractor({
      "turn-u1": [original],
    });

    const result = await extractFacts(transcript, extractor);

    expect(result.droppedCount).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(original);
  });
});
