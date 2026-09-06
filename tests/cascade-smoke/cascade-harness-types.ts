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
  /**
   * `tts:start` to `tts:audio:start`. Small on the Gemini leg's streaming
   * path (first chunk scheduled into Web Audio), close to the full synthesis
   * time on the buffered path (nothing plays until the whole reply arrives)
   * -- the number that shows whether the streaming branch actually fired.
   */
  ttsFirstAudioMs: number | null;
};

export type CascadeAvatarEvent =
  | { type: "expression"; expressionId: string }
  | { type: "motion"; group: string; index: number }
  | { type: "gaze"; x: number; y: number };

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
  /** Avatar events emitted by the LLM tool loop's result projector during the turn. */
  avatarEvents: CascadeAvatarEvent[];
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
  /**
   * Drive a turn from supplied text, skipping STT. Used to assert avatar-tool
   * behavior against a chosen utterance without minting a new audio fixture —
   * the canned WAV is shared with the webrtc suite and says only one thing.
   */
  runTextTurn: (text: string) => Promise<void>;
  getSnapshot: () => CascadeSnapshot;
  reset: () => void;
};

// Vite's `define` in vite.config.ts replaces this with the resolved
// CASCADE_TTS switch as a string literal at compile time. This file is a
// module (it has top-level `export`s), so a bare `declare const` here would
// be scoped to it and invisible to src/main.ts; `declare global` is what
// makes it visible program-wide.
declare global {
  const __CASCADE_TTS__: "openai" | "gemini";
}
