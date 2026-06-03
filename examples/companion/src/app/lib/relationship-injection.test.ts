import { describe, it, expect, beforeEach } from "vitest";

import { composeInstructions } from "./compose-instructions";
import { renderRelationshipBlock } from "../../memory/render-memory";
import { buildMemoryInstructionBlock } from "../../memory/build-memory-block";
import { renderSituationalContext } from "./situational-context";
import {
  LocalStorageMemoryStore,
  createInMemoryStorage,
} from "../../memory/local-storage-memory-store";
import type { MemoryScope } from "../../memory/types";

// p4-01 (updated for Task 5): the relationship block and situational block are
// both rendered separately and composed alongside the memory block at the hook's
// two composeInstructions sites. This test pins the COMPOSITION + DE-DUPLICATION
// through the same array shape the hook builds.
//
// Block order: ..., memoryBlock, relationshipBlock (second-to-last), situationalBlock (LAST).
//
// Scope (no overclaim): it does NOT instantiate useRealtimeSession and does NOT
// prove the two hook call sites are wired — that is the explicit, non-automated
// acceptance gap covered by the Task-3 diff review and the manual smoke. The
// once-count is the double-emission guard: re-bundling the relationship line
// inside buildMemoryInstructionBlock would make the count 2 and fail this test.

const NOW = 1_700_000_000_000;
const SCOPE: MemoryScope = { userId: "userX", characterId: "charX" };

// Fixed, timezone-deterministic situational Date: local 14:05 (not late),
// so only the fact line is rendered. Component constructor form → avoids
// timezone offset from ISO string parsing.
const SITU_DATE = new Date(2026, 5, 3, 14, 5);
const SITU = renderSituationalContext(SITU_DATE);

// Reproduces the hook's composeInstructions([...]) array EXACTLY (same block
// order, relationship second-to-last, situational LAST): memory block from the
// real store + relationship block rendered from the real store via the
// readRelationshipBlock seam (getRelationship -> renderRelationshipBlock).
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
  return composeInstructions([
    "You are a companion.", // persona stand-in
    null, // userName (none) — exercises the filter-drop path
    "Be brief.", // demo guidance stand-in
    "", // avatar control (none) — exercises the filter-drop path
    memoryBlock,
    relationshipBlock,
    SITU,
  ]);
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
