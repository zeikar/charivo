// Gemini Live defaults, intentionally duplicated with
// packages/server/src/gemini/realtime/index.ts. Strict layering keeps browser and
// server providers self-contained (no shared module / cross-package dep) — the
// same pattern the OpenAI realtime and tts/stt defaults follow.
export const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
export const DEFAULT_GEMINI_LIVE_VOICE = "Kore";

/** Rate the Live API expects for `audio/pcm` microphone input. */
export const INPUT_SAMPLE_RATE = 16000;
/** Rate the model's downstream audio arrives at (`audio/pcm;rate=24000`). */
export const OUTPUT_SAMPLE_RATE = 24000;
/** 20 ms at 16 kHz. No official chunk-size guidance exists. */
export const CAPTURE_FRAME_SAMPLES = 320;
/**
 * Safari's echo-canceller convergence allowance, in two roles that share one
 * number: the *window* after the character's voice becomes audible during which
 * microphone frames are held back, and the cumulative *exposure threshold* of
 * audible playback that disarms the gate for the rest of the session.
 *
 * They rest on different measurements, so moving this moves both: the window
 * answers the interruption offsets the live checks print (~0.5 s after playback
 * started, every time), while the threshold answers how much exposure the
 * canceller needed to converge (~1 s, banked across two killed turns before the
 * third survived intact). Both were measured on one machine, one room, one pair
 * of speakers — tune from those live numbers rather than from this constant
 * (`tests/gemini-live-smoke/README.md`).
 */
export const CONVERGENCE_GATE_MS = 700;
