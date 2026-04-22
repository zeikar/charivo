import type { RealtimeSessionConfig, RealtimeState } from "@charivo/core";

export type HarnessMode =
  | "smoke"
  | "default-prompt-eval"
  | "voice-e2e"
  | "voice-baseline";

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
  lastError: string | null;
  sessionInstructions: string | null;
  registeredTools: string[];
  toolCalls: Array<{ name: string; callId?: string }>;
  avatarEvents: Array<
    | { type: "expression"; expressionId: string }
    | { type: "motion"; group: string; index: number }
    | { type: "gaze"; x: number; y: number }
  >;
  voiceLatency: {
    sessionStartAt: number | null;
    firstAssistantEventAt: number | null;
    deltaMs: number | null;
  };
  events: HarnessEvent[];
};

export type SmokeHarnessApi = {
  startSession: () => Promise<void>;
  updateSession: (config?: RealtimeSessionConfig) => Promise<void>;
  sendPrompt: (text?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  getSnapshot: () => HarnessSnapshot;
};
