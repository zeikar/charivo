export type CascadeStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "responding"
  | "done"
  | "error";

export type CascadeEvent = {
  type: string;
  payload: unknown;
  at: number;
};

export type CascadeTimings = {
  recordMs: number | null;
  sttMs: number | null;
  turnMs: number | null;
  totalMs: number | null;
};

export type CascadeSnapshot = {
  status: CascadeStatus;
  transcript: string | null;
  assistantText: string | null;
  ttsAudioStarted: boolean;
  ttsAudioEnded: boolean;
  /**
   * Number of realtime lip-sync RMS updates that reached the renderer while the
   * synthesized audio played. Proves the browser audio→lip-sync loop ran.
   */
  lipsyncRmsUpdates: number;
  maxRms: number;
  lastError: string | null;
  timings: CascadeTimings;
  events: CascadeEvent[];
};

export type CascadeHarnessApi = {
  /**
   * Drive one full cascade turn: record the fake-mic WAV for `recordMs`,
   * transcribe (STT), generate a reply (LLM), and synthesize + play it (TTS).
   */
  runTurn: (recordMs?: number) => Promise<void>;
  getSnapshot: () => CascadeSnapshot;
  reset: () => void;
};
