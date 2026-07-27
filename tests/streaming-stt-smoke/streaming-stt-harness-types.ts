export type StreamingSTTStatus =
  | "idle"
  | "recording"
  | "stopping"
  | "done"
  | "error";

export type StreamingSTTSnapshot = {
  status: StreamingSTTStatus;
  /** Every `stt:partial` payload, in arrival order. */
  partials: string[];
  /**
   * Number of `stt:partial` events that had already arrived when `stop()` was
   * invoked. Greater than zero proves transcript deltas streamed over WebRTC
   * before any `input_audio_buffer.commit` was sent.
   */
  partialsBeforeStop: number;
  /** Authoritative transcript carried by `stt:stop`. */
  final: string | null;
  error: string | null;
};

export type StreamingSTTHarnessApi = {
  /** Begin recording. Fire-and-forget; the spec polls the snapshot. */
  start: () => void;
  /** Commit and finalize. Fire-and-forget; the spec polls the snapshot. */
  stop: () => void;
  getSnapshot: () => StreamingSTTSnapshot;
};
