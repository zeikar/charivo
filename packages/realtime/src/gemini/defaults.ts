// Gemini Live defaults, intentionally duplicated with
// packages/server/src/gemini/realtime/index.ts. Strict layering keeps browser and
// server providers self-contained (no shared module / cross-package dep) — the
// same pattern the OpenAI realtime and tts/stt defaults follow.
export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";

/** Rate the Live API expects for `audio/pcm` microphone input. */
export const INPUT_SAMPLE_RATE = 16000;
/** Rate the model's downstream audio arrives at (`audio/pcm;rate=24000`). */
export const OUTPUT_SAMPLE_RATE = 24000;
/** 20 ms at 16 kHz. No official chunk-size guidance exists. */
export const CAPTURE_FRAME_SAMPLES = 320;
/**
 * How long after the character's voice becomes audible microphone frames are
 * held back, so Safari's echo canceller can converge before the model hears the
 * character interrupting itself.
 *
 * Measured on one machine, one room, one pair of speakers — tune it from the
 * interruption offsets the live checks print, not from this constant
 * (`tests/gemini-live-smoke/README.md`).
 */
export const CONVERGENCE_GATE_MS = 700;
