import { describe, it, expect, beforeEach } from "vitest";

import { buildSessionInstructions } from "./build-session-instructions";
import { renderRelationshipBlock } from "../../memory/render-memory";
import { buildMemoryInstructionBlock } from "../../memory/build-memory-block";
import { renderSituationalContext } from "./situational-context";
import {
  LocalStorageMemoryStore,
  createInMemoryStorage,
} from "../../memory/local-storage-memory-store";
import type { MemoryScope } from "../../memory/types";

// p4-01 (updated for Task 5 + A): the relationship block and situational block
// are both rendered separately and composed alongside the memory block at the
// hook's two compose sites. This test pins the COMPOSITION + DE-DUPLICATION by
// calling the REAL buildSessionInstructions seam that BOTH hook sites use (not a
// reproduced array), so a block-order or de-dup regression in that seam fails here.
//
// Block order: ..., memoryBlock, relationshipBlock (second-to-last), situationalBlock (LAST).
//
// Scope (no overclaim): it does NOT instantiate useRealtimeSession; the residual
// non-automated gap is only that BOTH hook sites call buildSessionInstructions with
// the live blocks (diff-visible) — the seam's own block order / de-dup is now under
// test here. The once-count is the double-emission guard: re-bundling the
// relationship line inside buildMemoryInstructionBlock would make the count 2.

const NOW = 1_700_000_000_000;
const SCOPE: MemoryScope = { userId: "userX", characterId: "charX" };

// Fixed, timezone-deterministic situational Date: local 14:05 (not late),
// so only the fact line is rendered. Component constructor form → avoids
// timezone offset from ISO string parsing.
const SITU_DATE = new Date(2026, 5, 3, 14, 5);
const SITU = renderSituationalContext(SITU_DATE);

// Calls the REAL buildSessionInstructions seam (the same one both hook compose
// sites use), with the memory block from the real store + the relationship block
// rendered from the real store via the readRelationshipBlock path
// (getRelationship -> renderRelationshipBlock). Block order lives in the seam.
async function compose(store: LocalStorageMemoryStore): Promise<string> {
  const memoryBlock = await buildMemoryInstructionBlock({
    store,
    scope: SCOPE,
    now: NOW,
  });
  const relationshipBlock = renderRelationshipBlock(
    await store.getRelationship(SCOPE),
    { now: NOW },
  );
  return buildSessionInstructions({
    persona: "You are a companion.", // persona stand-in
    userNameBlock: null, // userName (none) — exercises the filter-drop path
    demoGuidance: "Be brief.", // demo guidance stand-in
    avatarBlock: "", // avatar control (none) — exercises the filter-drop path
    memoryBlock,
    relationshipBlock,
    situationalBlock: SITU,
  });
}

// Count non-overlapping occurrences of an exact substring.
function count(haystack: string, needle: string): number {
  return needle === "" ? 0 : haystack.split(needle).length - 1;
}

describe("relationship block injection (composition + de-duplication)", () => {
  let store: LocalStorageMemoryStore;

  beforeEach(() => {
    store = new LocalStorageMemoryStore({
      storage: createInMemoryStorage(),
      now: () => NOW,
    });
  });

  it("includes the rendered relationship block EXACTLY ONCE for sessionCount > 0", async () => {
    await store.putRelationship({
      scope: SCOPE,
      rapport: 0.8,
      sessionCount: 3,
      lastSeenAt: NOW,
      addressStyle: "casual",
      flags: {},
    });

    // Anchor on the rendered block itself (not wording fragments) so p4-02 text
    // changes do not churn this test.
    const rendered = renderRelationshipBlock(
      await store.getRelationship(SCOPE),
      { now: NOW },
    );
    expect(rendered).not.toBe(""); // precondition: a returning user renders a block

    const out = await compose(store);
    // Exactly once guards BOTH injection (>=1) and the double-emission
    // regression (a re-bundle inside buildMemoryInstructionBlock would make 2).
    expect(count(out, rendered)).toBe(1);
  });

  it("omits the relationship block for a first meeting (no relationship stored)", async () => {
    expect(
      renderRelationshipBlock(await store.getRelationship(SCOPE), { now: NOW }),
    ).toBe("");

    const out = await compose(store);
    // The "" relationship block (and the "" memory block) were dropped by
    // composeInstructions's filter; only the surviving stand-ins remain plus
    // the always-present situational block.
    expect(out).toBe(["You are a companion.", "Be brief.", SITU].join("\n"));
  });

  it("omits the relationship block for a first meeting (sessionCount <= 0)", async () => {
    await store.putRelationship({
      scope: SCOPE,
      rapport: 0.8,
      sessionCount: 0,
      lastSeenAt: NOW,
      addressStyle: "casual",
      flags: {},
    });

    expect(
      renderRelationshipBlock(await store.getRelationship(SCOPE), { now: NOW }),
    ).toBe("");

    const out = await compose(store);
    expect(out).toBe(["You are a companion.", "Be brief.", SITU].join("\n"));
  });
});
