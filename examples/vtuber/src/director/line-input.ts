// Builds each line's typed input. The kind tells the model a private cue and
// a world event from something a viewer said, so no text has to carry a tag.

import type { LineInput } from "./types";

export const MAX_NAME_LENGTH = 40;
export const MAX_TEXT_LENGTH = 280;

// Viewer and agent strings come from outside the show, so they are flattened
// to one line and capped.
function sanitize(value: string, maxLength: number): string {
  const flat = value.replace(/\s+/g, " ");
  // Cap by code point so a surrogate pair is never split; trim after the cap
  // so a cut never leaves a trailing space.
  return Array.from(flat.trim()).slice(0, maxLength).join("").trim();
}

/** Cues are written by the app, not by viewers, so they are left as written. */
export function directorCueInput(text: string): LineInput {
  return { kind: "direction", text };
}

export function viewerChatInput(viewer: string, text: string): LineInput {
  return {
    kind: "user",
    speaker: sanitize(viewer, MAX_NAME_LENGTH),
    text: sanitize(text, MAX_TEXT_LENGTH),
  };
}

export function agentEventInput(source: string, text: string): LineInput {
  return {
    kind: "event",
    source: sanitize(source, MAX_NAME_LENGTH),
    text: sanitize(text, MAX_TEXT_LENGTH),
    respond: "must",
  };
}

const LEAK = /\bdirectors?\b/i;

/**
 * True when a reply names the director. It cannot catch a paraphrase of a
 * cue; that is left to reading the live replies. It is coarse on purpose: an
 * innocent "film director" is flagged too.
 */
export function findCueLeak(reply: string): boolean {
  return LEAK.test(reply);
}
