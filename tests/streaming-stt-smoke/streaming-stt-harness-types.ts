export type StreamingSTTStatus =
  | "idle"
  /**
   * `start()` was called, but nothing is captured yet: the bootstrap mint, the
   * transport handshake, and the capture worklet all still have to finish.
   * Kept distinct from `recording` because a fixed record window measured from
   * `start()` spends itself on that bring-up instead of on audio, and a
   * recording the server heard no speech in yields no transcript at all.
   */
  | "starting"
  /** Capture is live: audio is reaching the session. */
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
   * invoked. Greater than zero proves transcript deltas reached the app while
   * audio was still streaming, before `stop()` was invoked.
   */
  partialsBeforeStop: number;
  /** Authoritative transcript carried by `stt:stop`. */
  final: string | null;
  error: string | null;
};

export type StreamingSTTHarnessApi = {
  /**
   * Ask the session to start. Fire-and-forget; the spec polls the snapshot,
   * which reaches `recording` only once capture is actually live.
   */
  start: () => void;
  /** Commit and finalize. Fire-and-forget; the spec polls the snapshot. */
  stop: () => void;
  getSnapshot: () => StreamingSTTSnapshot;
};
