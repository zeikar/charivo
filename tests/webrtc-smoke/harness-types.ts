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
  assistantText: string;
  lastError: string | null;
  toolCalls: Array<{ name: string; callId?: string }>;
  avatarEvents: Array<
    | { type: "expression"; expressionId: string }
    | { type: "motion"; group: string; index: number }
    | { type: "gaze"; x: number; y: number }
  >;
  events: HarnessEvent[];
};

export type SmokeHarnessApi = {
  startSession: () => Promise<void>;
  sendPrompt: (text?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  getSnapshot: () => HarnessSnapshot;
};
