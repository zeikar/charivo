import { composeInstructions } from "./compose-instructions";

/**
 * The ordered instruction blocks a realtime companion session composes. Both
 * useRealtimeSession compose sites — the cold-start `startSession` and the
 * first-utterance `updateSession` refresh — build their instructions through
 * this single seam, so the block ORDER lives in exactly one place and is
 * unit-testable without rendering the hook. Falsy blocks are dropped downstream
 * by composeInstructions's filter (e.g. relationship "" for a first meeting,
 * userName null when unset).
 */
export interface SessionInstructionBlocks {
  /**
   * Persona block from the character definition (buildRealtimeSessionConfig).
   * May be undefined if the config yields no instructions — dropped by the filter.
   */
  persona: string | undefined;
  /** Sanitized user self-name block, or null when no name is set (dropped). */
  userNameBlock: string | null;
  /** Demo-guidance block (keep replies short/natural for the voice demo). */
  demoGuidance: string;
  /** Avatar-control tool block (buildAvatarControlInstructions). */
  avatarBlock: string;
  /** Memory block (facts; "" and dropped when empty). */
  memoryBlock: string;
  /** Relationship-state guidance (gated; "" and dropped for a first meeting). */
  relationshipBlock: string;
  /** Situational date/time block (ungated; always present). */
  situationalBlock: string;
}

/**
 * Compose the per-session instruction string from its ordered blocks. Canonical
 * order: persona → user name → demo guidance → avatar → memory → relationship →
 * situational. Falsy blocks are filtered out by composeInstructions.
 */
export function buildSessionInstructions(
  blocks: SessionInstructionBlocks,
): string {
  return composeInstructions([
    blocks.persona,
    blocks.userNameBlock,
    blocks.demoGuidance,
    blocks.avatarBlock,
    blocks.memoryBlock,
    blocks.relationshipBlock,
    blocks.situationalBlock,
  ]);
}
