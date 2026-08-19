import type {
  RealtimeSessionConfig,
  RealtimeState,
  RealtimeUsageEvent,
} from "@charivo/core";

export type HarnessMode =
  | "smoke"
  | "avatar-prompt-eval"
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
  usageEvents: RealtimeUsageEvent[];
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
  /**
   * Cumulative counters, so a spec can diff them across turns. Lip-sync runs
   * off an analyzer that is paused at every playback end and has to be resumed
   * for the next one; only a second turn shows whether the resume happened.
   */
  lipSync: {
    audioStarts: number;
    audioEnds: number;
    activeSamples: number;
  };
  events: HarnessEvent[];
};

export type SmokeHarnessApi = {
  startSession: () => Promise<void>;
  forceReconnectOutage: () => Promise<void>;
  updateSession: (config?: RealtimeSessionConfig) => Promise<void>;
  sendPrompt: (text?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  getSnapshot: () => HarnessSnapshot;
};
