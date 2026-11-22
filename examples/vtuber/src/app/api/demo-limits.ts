/**
 * Bounds for this example's chat route, an unauthenticated proxy onto
 * `GEMINI_API_KEY`, so the defence is shape: pin the model, and bound what one
 * request can carry. The example is local-only (loopback), and deliberately
 * has no rate limiting or request counting.
 */

/**
 * `LLMManager` counts history in turns and keeps `maxHistoryTurns * 2`
 * messages (a turn is a user message plus the reply). The app passes this as
 * `maxHistoryTurns`, so the manager never sends more than the route accepts.
 * `LLMManager`'s default of 40 turns (80 messages) would exceed any sane route
 * cap, and a long show would then be rejected mid-run.
 */
export const SHOW_MAX_HISTORY_TURNS = 20;

/**
 * One tool round is an assistant message carrying the calls plus one `tool`
 * message per call; `LLMManager` runs at most three rounds. Four calls per
 * round is generous for an avatar that sets an expression and plays a motion.
 */
export const TOOL_LOOP_ROUNDS = 3;
const TOOL_CALLS_PER_ROUND = 4;

/**
 * System message + two per history turn + tool-loop headroom:
 * 1 + 20 * 2 + 3 * (1 + 4) = 56.
 */
export const CHAT_MAX_MESSAGES =
  1 +
  SHOW_MAX_HISTORY_TURNS * 2 +
  TOOL_LOOP_ROUNDS * (1 + TOOL_CALLS_PER_ROUND);

/**
 * Everything below is paid input. `content` is not the only part of it — tool
 * schemas, tool-call arguments, and ids are forwarded to the provider too, so
 * the serialized payload is what has to be bounded.
 */
export const CHAT_MAX_MESSAGE_CHARS = 8_000;
export const CHAT_MAX_TOTAL_CHARS = 60_000;
export const CHAT_MAX_TOOLS = 24;
export const CHAT_MAX_TOOL_CALLS_PER_MESSAGE = 16;
export const CHAT_MAX_TOOLS_BYTES = 32_768;
export const CHAT_MAX_TOOL_CALLS_BYTES = 16_384;
export const CHAT_MAX_TOOL_CALL_ID_CHARS = 256;

/** Pinned so the route picks the model it pays for instead of inheriting the provider default. */
export const CHAT_GEMINI_MODEL = "gemini-3.5-flash-lite";
