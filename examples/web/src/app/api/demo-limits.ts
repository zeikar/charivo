/**
 * Cost boundaries for the public demo deployment.
 *
 * Every route under `src/app/api/` is an unauthenticated proxy to a paid OpenAI
 * key. There is no auth, no per-IP quota, and no rate limiting — read the
 * README's "Deploying this demo" section before copying any of it.
 *
 * The defence here is shape, not volume: pin every cost-bearing parameter
 * server-side and bound the size of a single request, so a caller cannot
 * repoint the key at an expensive model, supply their own system prompt, or
 * make one request cost meaningful money. Bounding *total* volume is a
 * different problem and is left to a per-project spend limit on the OpenAI
 * side.
 */
import { CHARACTER_CONFIGS } from "../config/characters";

/**
 * Realtime is billed on wall-clock audio, so session duration — not request
 * count — is what drives its cost.
 */
export const REALTIME_MODEL = "gpt-realtime-2.1-mini";

/**
 * Matches the model `@charivo/stt/openai-realtime` sends. Pinned here anyway:
 * the route pays for whatever it mints, so it picks.
 */
export const REALTIME_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

/**
 * Enforced by a client-side timer (see `useRealtimeMode`). After bootstrap the
 * browser talks to OpenAI directly, so the server is out of the loop and cannot
 * hang up — this bounds an ordinary visitor's cost, and a caller who ignores it
 * is bounded by the spend limit instead.
 */
export const REALTIME_SESSION_MAX_MS = 90_000;

/** Ample for the demo's character prompt plus its avatar catalog (~2 KB). */
export const REALTIME_MAX_INSTRUCTIONS_CHARS = 8_000;

export const REALTIME_MAX_OUTPUT_TOKENS = 4_096;

/** The demo registers well under ten avatar tools. */
export const REALTIME_MAX_TOOLS = 24;

/** Bounds tool JSON Schemas, which are attacker-supplied and unbounded. */
export const REALTIME_MAX_TOOLS_BYTES = 32_768;

/** TTS is billed per input character. */
export const TTS_MAX_TEXT_CHARS = 2_000;

export const TTS_DEFAULT_VOICE = "marin";

/**
 * Derived from the characters the demo actually ships, so adding a character
 * cannot leave this list stale.
 */
export const TTS_ALLOWED_VOICES: ReadonlySet<string> = new Set(
  [
    TTS_DEFAULT_VOICE,
    ...Object.values(CHARACTER_CONFIGS).map(
      (config) => config.character.voice?.voiceId,
    ),
  ].filter((voiceId): voiceId is string => typeof voiceId === "string"),
);

/**
 * STT is billed per audio minute, and size is the only proxy available before
 * paying for the transcription. 10 MB is roughly ten minutes — about $0.06 at
 * `whisper-1` rates, and well under OpenAI's own 25 MB ceiling.
 */
export const STT_MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export const CHAT_MAX_MESSAGES = 40;
export const CHAT_MAX_MESSAGE_CHARS = 8_000;
export const CHAT_MAX_TOTAL_CHARS = 60_000;
export const CHAT_MAX_TOOLS = 24;
