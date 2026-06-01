// The selected character id is selection/UI state, persisted separately from
// the user name because it governs which companion model and persona are loaded
// (not who the AI is speaking to). The persisted value is an id validated
// against the catalog via `isCharacterId` (membership check) before any read or
// write, so a stale or garbage stored value can never produce an unknown
// character. Resolution to a stable catalog reference is done elsewhere via
// `getCharacterById` — mirroring the user-name-store pattern where sanitization
// on load/save keeps the stored value well-formed.

import { isCharacterId } from "./character-catalog";

/** localStorage key for the selected character id; sibling to USER_NAME_STORAGE_KEY. */
export const CHARACTER_STORAGE_KEY = "charivo:companion:character-id";

/**
 * Returns the stored character id, or null when not set / SSR / unknown id /
 * error. Validates with isCharacterId so a stale or garbage value is rejected.
 */
export function loadCharacterId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
    if (stored === null) return null;
    return isCharacterId(stored) ? stored : null;
  } catch (error) {
    console.warn("[character-store] load failed", error);
    return null;
  }
}

/**
 * Persists the character id. No-ops under SSR or when the id is not in the
 * catalog (never persist an unknown id).
 */
export function saveCharacterId(id: string): void {
  if (typeof window === "undefined") return;
  if (!isCharacterId(id)) return;
  try {
    window.localStorage.setItem(CHARACTER_STORAGE_KEY, id);
  } catch (error) {
    console.warn("[character-store] save failed", error);
  }
}

/**
 * Removes the stored character id. Used when resetting selection state.
 * No-op under SSR.
 */
export function clearCharacterId(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CHARACTER_STORAGE_KEY);
  } catch (error) {
    console.warn("[character-store] clear failed", error);
  }
}
