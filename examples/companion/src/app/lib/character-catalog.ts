// Character catalog: the single source of truth for every selectable companion.
// All entries are module-level constants (never re-created per render) so that
// resolved-character references remain stable across renders — the render effect
// in useRealtimeSession uses resolvedCharacter in its deps, and a new object
// reference would cause unnecessary teardown/rebuild.

import type { Character } from "@charivo/core";

/** Character shape augmented with the model path the renderer loads. */
export interface CompanionCharacter extends Character {
  modelPath: string;
}

// ---------------------------------------------------------------------------
// Catalog entries (stable module constants — never move inside a function)
// ---------------------------------------------------------------------------

const HIYORI: CompanionCharacter = {
  id: "companion-default", // memory-scope key — never change
  name: "Hiyori", // seed: display name
  description: "A thoughtful and gentle character with a calm demeanor", // seed: short card blurb
  personality:
    "Soft-spoken, empathetic, and caring. Takes time to listen and respond thoughtfully. Uses polite and soothing language, creating a comfortable atmosphere.", // seed: persona-instruction prompt
  voice: { voiceId: "marin", rate: 1.0, pitch: 1.2, volume: 0.8 },
  modelPath: "/live2d/Hiyori/Hiyori.model3.json",
};

const GENKI: CompanionCharacter = {
  id: "companion-genki", // memory-scope key — never change
  name: "Yuki", // seed: display name
  description: "A bright, playful spark who turns every moment into fun.", // seed: short card blurb
  personality:
    "Energetic, cheerful, and a little teasing — but always warm. Loves to laugh and keep things lively, turning even quiet moments into something fun. Speaks with enthusiasm and a playful edge, yet genuinely cares about the person she's talking with.", // seed: persona-instruction prompt
  voice: { voiceId: "cedar", rate: 1.0, pitch: 1.2, volume: 0.8 },
  modelPath:
    "/live2d/sample-model-basic-series-v3_vts/sample-model-basic-series-v3.model3.json",
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All selectable companion characters. Order determines display order. */
export const CHARACTER_CATALOG: readonly CompanionCharacter[] = [HIYORI, GENKI];

/** Default character id (Hiyori). Used as the fallback in getCharacterById. */
export const DEFAULT_CHARACTER_ID = "companion-default";

/**
 * Returns true when `id` matches an entry in the catalog.
 * Use this for validation (e.g. before persisting to the store).
 */
export function isCharacterId(id: string | null): boolean {
  return CHARACTER_CATALOG.some((c) => c.id === id);
}

/**
 * Resolves a catalog entry by id. Falls back to the default entry (Hiyori)
 * when `id` is null or not found. Always returns the stable catalog constant —
 * never a fresh object — so the resolved reference is safe in effect deps.
 */
export function getCharacterById(id: string | null): CompanionCharacter {
  return (
    CHARACTER_CATALOG.find((c) => c.id === id) ??
    // Non-null assertion: HIYORI (DEFAULT_CHARACTER_ID) is always in the catalog.
    CHARACTER_CATALOG.find((c) => c.id === DEFAULT_CHARACTER_ID)!
  );
}
