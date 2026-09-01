import type { RealtimeState } from "@charivo/core";

/**
 * `smoke` is the deterministic mode: one named expression, `setExpression`
 * only, and instructions that name both — so the gated spec asserts a fixed
 * round-trip rather than whatever the model felt like calling.
 * `avatar-prompt-eval` swaps in the opaque `F01`..`F08` catalog and the full
 * canonical tool surface to evaluate prompt-driven selection.
 */
export type HarnessMode = "smoke" | "avatar-prompt-eval";

export type HarnessEvent = {
  type: string;
  payload: unknown;
  at: number;
};

export type HarnessSnapshot = {
  mode: HarnessMode;
  sessionStatus: RealtimeState["session"]["status"];
  connection: RealtimeState["connection"];
  assistantStatus: RealtimeState["response"]["status"];
  assistantCompletions: number;
  assistantText: string;
  /**
   * One entry per `realtime:user:transcript`. Kept as a list rather than a
   * joined string because whether a long Korean sentence arrives as one
   * transcript or several is one of the open live questions (README.md).
   */
  userTranscripts: string[];
  /** Names only; the catalog each mode registers is the thing under test. */
  registeredTools: string[];
  /**
   * Read off the committed session config, so it is populated only once the
   * manager has an active session — never from what the page intended to send.
   */
  sessionInstructions: string | null;
  toolCalls: Array<{
    name: string;
    callId?: string;
    args: Record<string, unknown>;
  }>;
  /** Canonical avatar events, projected from successful tool results. */
  avatarEvents: Array<
    | { type: "expression"; expressionId: string }
    | { type: "motion"; group: string; index: number; muteSound?: boolean }
    | { type: "gaze"; x: number; y: number }
  >;
  lastError: string | null;
  /**
   * Chronological, so a spec can check ordering rather than just membership —
   * a user transcript must land before the assistant turn it prompted.
   */
  events: HarnessEvent[];
};

export type SmokeHarnessApi = {
  startSession: () => Promise<void>;
  sendPrompt: (text?: string) => Promise<void>;
  interrupt: () => Promise<void>;
  stopSession: () => Promise<void>;
  getSnapshot: () => HarnessSnapshot;
};
