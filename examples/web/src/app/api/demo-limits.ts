/**
 * Cost boundaries for the public demo deployment.
 *
 * Every route under `src/app/api/` is an unauthenticated proxy. The OpenAI-backed
 * routes spend `OPENAI_API_KEY`; `/api/chat-gemini` spends only `GEMINI_API_KEY`;
 * `/api/realtime` spends `GEMINI_API_KEY` when the Gemini provider is selected
 * and `OPENAI_API_KEY` otherwise; `/api/chat-openclaw` — which forwards to
 * `OPENCLAW_BASE_URL` with `OPENCLAW_TOKEN` — spends neither. There is no auth,
 * no per-IP quota, and no rate limiting — read the README's "Deploying this
 * demo" section before copying any of it.
 *
 * The limits below cover the OpenAI- and Gemini-backed routes, including
 * `/api/chat-gemini`; `/api/chat-openclaw` shares only the `chat-request`
 * payload bounds.
 *
 * The defence here is shape, not volume: pin every cost-bearing parameter
 * server-side and bound the size of a single request, so a caller cannot
 * repoint the key at an expensive model, raise the output ceiling, or make one
 * request cost meaningful money. Bounding *total* volume is a different problem
 * and is left to a per-project spend limit on each provider's side.
 *
 * `instructions` is the deliberate exception: the demo composes them in the
 * browser from the avatar catalog of whichever model finished loading, so the
 * server cannot rebuild them. They are size-capped, not pinned — a caller can
 * still supply their own system prompt on the pinned model.
 */
import { CHARACTER_CONFIGS } from "../config/characters";

/**
 * Realtime is billed on wall-clock audio, so session duration — not request
 * count — is what drives its cost, for either provider.
 */
export const REALTIME_OPENAI_MODEL = "gpt-realtime-2.1-mini";

/**
 * Pinned here so the route picks the model it pays for instead of inheriting
 * `@charivo/server/gemini`'s default. `gemini-3.1-flash-live-preview` is the
 * model `tests/gemini-live-smoke/README.md` records as exercised against the
 * live API.
 */
export const REALTIME_GEMINI_MODEL = "gemini-3.1-flash-live-preview";

/**
 * Matches the model `@charivo/stt/openai-realtime` sends. Pinned here anyway:
 * the route pays for whatever it mints, so it picks.
 */
export const REALTIME_TRANSCRIPTION_MODEL = "gpt-realtime-whisper";

/**
 * Enforced by a client-side timer (see `useRealtimeMode`). After bootstrap the
 * browser talks to the provider directly, so the server is out of the loop and
 * cannot hang up — this bounds an ordinary visitor's cost, and a caller who
 * ignores it is bounded by the spend limit instead.
 *
 * Development loosens it rather than removing it. 90 seconds is pure friction
 * while debugging a realtime session, but realtime bills on wall clock, so a
 * session left open on your own key overnight is expensive too — 15 minutes
 * clears any working session while still catching a walked-away tab. Next.js
 * substitutes `NODE_ENV` with a literal at build time, so a deployed bundle
 * keeps only the 90s branch; there is no runtime switch to get wrong.
 */
export const REALTIME_SESSION_MAX_MS =
  process.env.NODE_ENV === "production" ? 90_000 : 15 * 60_000;

/** Ample for the demo's character prompt plus its avatar catalog (~2 KB). */
export const REALTIME_MAX_INSTRUCTIONS_CHARS = 8_000;

export const REALTIME_MAX_OUTPUT_TOKENS = 4_096;

/** The demo registers well under ten avatar tools. */
export const REALTIME_MAX_TOOLS = 24;

/** Bounds tool JSON Schemas, which are attacker-supplied and unbounded. */
export const REALTIME_MAX_TOOLS_BYTES = 32_768;

/** The only values the Realtime API accepts; anything else is rejected. */
export const REALTIME_TOOL_CHOICES = ["auto", "none", "required"] as const;

/** TTS is billed per input character. */
export const TTS_MAX_TEXT_CHARS = 2_000;

/**
 * Only used when a request carries no voice at all — a character's own
 * `voice.voiceId` always wins, because `Charivo` passes it down as a TTS option
 * (`packages/core/src/index.ts`) and the remote player prefers it over its own
 * default. Deliberately a voice no shipped character uses: if this ever does
 * fire, a voiceless character should not end up impersonating Hiyori.
 */
export const TTS_FALLBACK_VOICE = "sage";

/**
 * Derived from the characters the demo actually ships, so adding a character
 * cannot leave this list stale.
 */
export const TTS_ALLOWED_VOICES: ReadonlySet<string> = new Set(
  [
    TTS_FALLBACK_VOICE,
    ...Object.values(CHARACTER_CONFIGS).map(
      (config) => config.character.voice?.voiceId,
    ),
  ].filter((voiceId): voiceId is string => typeof voiceId === "string"),
);

/**
 * STT is billed per audio *minute*, which bytes bound only loosely: a low-bitrate
 * Opus stream packs far more speech into a megabyte than a typical recording
 * does. Measuring duration would mean decoding audio in the route, which is out
 * of proportion here — so this is sized for the worst case instead of the
 * typical one. A demo utterance runs well under 1 MB at ordinary bitrates, while
 * 1 MB of 8 kbps audio is still only ~17 minutes, or roughly $0.10 at
 * `whisper-1` rates. Treat it as an upload bound, not a cost guarantee.
 */
export const STT_MAX_AUDIO_BYTES = 1024 * 1024;

/** Pinned here so the route picks the model it pays for instead of inheriting `@charivo/server/gemini`'s default. */
export const CHAT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const CHAT_MAX_MESSAGES = 40;

/**
 * Everything below is paid input. `content` is not the only part of it — tool
 * schemas, tool-call arguments, names, and ids are all forwarded to the
 * provider, so the serialized payload is what actually has to be bounded.
 */
export const CHAT_MAX_MESSAGE_CHARS = 8_000;
export const CHAT_MAX_TOTAL_CHARS = 60_000;
export const CHAT_MAX_TOOLS = 24;
export const CHAT_MAX_TOOL_CALLS_PER_MESSAGE = 16;
export const CHAT_MAX_TOOLS_BYTES = 32_768;
export const CHAT_MAX_TOOL_CALLS_BYTES = 16_384;
export const CHAT_MAX_TOOL_CALL_ID_CHARS = 256;
