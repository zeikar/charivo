// The user name is the *self* name (what the AI calls the user), stored
// separately from the memory store because it is identity/UI state, not a
// memory fact. It does NOT affect the memory `characterId` scope.
//
// `sanitizeUserName` is also the prompt-injection boundary (strips control
// chars + bounds length) for the value later embedded in model instructions.

/** localStorage key for the user's self name; sibling to MEMORY_STORAGE_KEYS. */
export const USER_NAME_STORAGE_KEY = "charivo:companion:user-name";

/** Maximum display-name length stored and embedded in instructions. */
export const MAX_USER_NAME_LENGTH = 40;

/**
 * Strips control characters (including newlines/tabs), collapses whitespace,
 * trims, and truncates to MAX_USER_NAME_LENGTH. May return an empty string.
 * This is the single sanitizer shared by load, save, the UI, and the
 * instruction builder.
 */
export function sanitizeUserName(raw: string): string {
  return (
    raw
      // Intentionally match control chars (incl. newlines/tabs) + DEL to strip
      // the prompt-injection / forged-instruction-line vector. The escaped form
      // keeps the source readable; no-control-regex is disabled for this line.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_USER_NAME_LENGTH)
      .trim()
  );
}

/**
 * Returns the stored user name, or null when not set / SSR / empty / error.
 * Sanitizes on read so any pre-existing garbage stored value is normalized.
 */
export function loadUserName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_NAME_STORAGE_KEY);
    if (raw === null) return null;
    const clean = sanitizeUserName(raw);
    return clean === "" ? null : clean;
  } catch (error) {
    console.warn("[user-name-store] load failed", error);
    return null;
  }
}

/**
 * Sanitizes and persists the user name. No-ops under SSR or when the sanitized
 * result is empty (never persist a blank name).
 */
export function saveUserName(name: string): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeUserName(name);
  if (clean === "") return;
  try {
    window.localStorage.setItem(USER_NAME_STORAGE_KEY, clean);
  } catch (error) {
    console.warn("[user-name-store] save failed", error);
  }
}

/**
 * Removes the stored user name. Used by the change-name exit in the onboarding
 * flow. No-op under SSR.
 */
export function clearUserName(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(USER_NAME_STORAGE_KEY);
  } catch (error) {
    console.warn("[user-name-store] clear failed", error);
  }
}
