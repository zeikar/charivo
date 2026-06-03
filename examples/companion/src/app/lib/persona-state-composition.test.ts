import { describe, it, expect, beforeEach } from "vitest";

import { buildSessionInstructions } from "./build-session-instructions";
import { renderPersonaInstructions } from "./persona";
import { renderRelationshipBlock } from "../../memory/render-memory";
import { buildMemoryInstructionBlock } from "../../memory/build-memory-block";
import { renderSituationalContext } from "./situational-context";
import {
  LocalStorageMemoryStore,
  createInMemoryStorage,
} from "../../memory/local-storage-memory-store";
import { getCharacterById } from "./character-catalog";
import type { MemoryScope, RelationshipState } from "../../memory/types";

// p4-03: prove that the SAME character + SAME topic, under DIFFERENT relationship
// state, yields a DIFFERENT composed prompt BECAUSE THE PERSONA HOOK CHANGED,
// and that invariants are ALWAYS present.
//
// Gate: tests fail if stateHooks are removed from Hiyori's persona definition
// (hook strings are read off realHiyori.persona.stateHooks, not hardcoded).

const NOW = 1_700_000_000_000;
// lastSeenAt close to NOW: gap = 0 ms, well under STALE_AFTER_MS (14 days)
// → cadence bucket = "established" for sessionCount > EARLY_RETURNING_MAX (1)
const RECENT_LAST_SEEN = NOW;

const SCOPE: MemoryScope = { userId: "userX", characterId: "charX" };

// Fixed, timezone-deterministic situational Date: local 14:05 (not late),
// so only the fact line is rendered. Component constructor form → avoids
// timezone offset from ISO string parsing.
const SITU_DATE = new Date(2026, 5, 3, 14, 5);
const SITU = renderSituationalContext(SITU_DATE);

const realHiyori = getCharacterById("companion-default");

// Compose helper: reads relationship state from the store, renders persona
// (including state-dependent hook) and all other blocks, then calls the REAL
// buildSessionInstructions seam — same path both hook compose sites use.
async function compose(store: LocalStorageMemoryStore): Promise<string> {
  const state = await store.getRelationship(SCOPE);

  const persona = renderPersonaInstructions(realHiyori, state, { now: NOW });

  const memoryBlock = await buildMemoryInstructionBlock({
    store,
    scope: SCOPE,
    now: NOW,
  });

  const relationshipBlock = renderRelationshipBlock(state, { now: NOW });

  return buildSessionInstructions({
    persona,
    userNameBlock: null,
    demoGuidance: "Be brief.",
    avatarBlock: "",
    memoryBlock,
    relationshipBlock,
    situationalBlock: SITU,
  });
}

async function seedRelationship(
  store: LocalStorageMemoryStore,
  overrides: Partial<RelationshipState>,
): Promise<void> {
  await store.putRelationship({
    scope: SCOPE,
    rapport: 0,
    sessionCount: 3,
    lastSeenAt: RECENT_LAST_SEEN,
    addressStyle: "casual",
    flags: {},
    ...overrides,
  });
}

describe("persona state composition (hook + invariant gates)", () => {
  let store: LocalStorageMemoryStore;

  beforeEach(() => {
    store = new LocalStorageMemoryStore({
      storage: createInMemoryStorage(),
      now: () => NOW,
    });
  });

  it("Case A low rapport: output contains low-hook, NOT warm-hook, invariants present", async () => {
    await seedRelationship(store, { rapport: -0.8, sessionCount: 3 });

    // Read hook strings off the real persona so the test fails if stateHooks removed.
    const lowHook = realHiyori.persona!.stateHooks["rapport:low"]!;
    const warmHook = realHiyori.persona!.stateHooks["rapport:warm"]!;
    const invariantVoice = realHiyori.persona!.invariants.voice;
    const invariantValues = realHiyori.persona!.invariants.values;

    const out = await compose(store);

    expect(out).toContain(lowHook);
    expect(out).not.toContain(warmHook);

    // Invariants always present.
    expect(out).toContain(invariantVoice);
    for (const val of invariantValues) {
      expect(out).toContain(val);
    }
  });

  it("Case B warm rapport: output contains warm-hook, NOT low-hook, invariants present", async () => {
    await seedRelationship(store, { rapport: 0.8, sessionCount: 3 });

    const lowHook = realHiyori.persona!.stateHooks["rapport:low"]!;
    const warmHook = realHiyori.persona!.stateHooks["rapport:warm"]!;
    const invariantVoice = realHiyori.persona!.invariants.voice;
    const invariantValues = realHiyori.persona!.invariants.values;

    const out = await compose(store);

    expect(out).toContain(warmHook);
    expect(out).not.toContain(lowHook);

    expect(out).toContain(invariantVoice);
    for (const val of invariantValues) {
      expect(out).toContain(val);
    }
  });

  it("Case A !== Case B: different relationship state yields different composed prompt", async () => {
    await seedRelationship(store, { rapport: -0.8, sessionCount: 3 });
    const outA = await compose(store);

    // Reset store for Case B.
    const storeB = new LocalStorageMemoryStore({
      storage: createInMemoryStorage(),
      now: () => NOW,
    });
    await seedRelationship(storeB, { rapport: 0.8, sessionCount: 3 });
    const outB = await compose(storeB);

    expect(outA).not.toBe(outB);
  });

  it("first-meeting: invariants present, relationshipBlock empty, no stateHook line", async () => {
    // sessionCount: 0, non-neutral rapport — would yield a hook if the
    // first-meeting guard did not suppress it.
    await seedRelationship(store, { rapport: -0.8, sessionCount: 0 });

    // Precondition: renderRelationshipBlock returns "" for sessionCount <= 0.
    const state = await store.getRelationship(SCOPE);
    expect(renderRelationshipBlock(state, { now: NOW })).toBe("");

    const invariantVoice = realHiyori.persona!.invariants.voice;
    const invariantValues = realHiyori.persona!.invariants.values;

    const out = await compose(store);

    // Invariants are the always-on floor — present even for first meeting.
    expect(out).toContain(invariantVoice);
    for (const val of invariantValues) {
      expect(out).toContain(val);
    }

    // No persona state hook should appear (first-meeting guard suppresses all hooks).
    for (const hook of Object.values(realHiyori.persona!.stateHooks)) {
      if (hook) {
        expect(out).not.toContain(hook);
      }
    }
  });
});
