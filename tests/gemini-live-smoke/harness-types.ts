import type { RealtimeState } from "@charivo/core";

export type HarnessEvent = {
  type: string;
  payload: unknown;
  at: number;
};

export type HarnessSnapshot = {
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
  toolCalls: Array<{
    name: string;
    callId?: string;
    args: Record<string, unknown>;
  }>;
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
