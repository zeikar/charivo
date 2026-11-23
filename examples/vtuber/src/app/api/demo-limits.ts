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
 * The show's callers no longer send tools (the avatar director classifies in
 * a separate, tool-free request), but the route's request contract is
 * unchanged, so the tool headroom below stays.
 *
 * One tool round is an assistant message carrying the calls plus one `tool`
 * message per call; `LLMManager` runs at most three rounds. Four calls per
 * round is generous for a caller that sets an expression and plays a motion.
 *
 * TOOL_LOOP_ROUNDS mirrors `MAX_TOOL_ROUNDS` in @charivo/llm
 * (packages/llm/src/llm-manager.ts), which is private, so it is copied here:
 * when that changes, change this with it.
 */
export const TOOL_LOOP_ROUNDS = 3;
export const TOOL_CALLS_PER_ROUND = 4;
const TOOL_ROUNDS_TOOL_RESULTS = TOOL_LOOP_ROUNDS * TOOL_CALLS_PER_ROUND;

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

/**
 * The route bounds every reply it returns, because a reply comes back as an
 * assistant message in the next requests, and one too long for the limits above
 * would make every following turn fail validation. The budget is what is left
 * of CHAT_MAX_TOTAL_CHARS for replies once everything else a full request
 * carries is reserved:
 *   system message                      6 000
 *   21 user messages (cue or chat) x 400  8 400  (a full history plus the new one)
 *   12 tool results x 200                2 400  (3 rounds x 4 calls)
 *   left for replies        60 000 - 16 800 = 43 200
 *   replies: 20 history + 3 tool-round assistant messages = 23
 *   43 200 / 23 = 1 878 characters each, below CHAT_MAX_MESSAGE_CHARS.
 */
const SYSTEM_MESSAGE_RESERVE_CHARS = 6_000;
const USER_MESSAGE_RESERVE_CHARS = 400;
const TOOL_RESULT_RESERVE_CHARS = 200;
const REPLIES_PER_REQUEST = SHOW_MAX_HISTORY_TURNS + TOOL_LOOP_ROUNDS;
export const CHAT_REPLY_MAX_CHARS = Math.min(
  CHAT_MAX_MESSAGE_CHARS,
  Math.floor(
    (CHAT_MAX_TOTAL_CHARS -
      SYSTEM_MESSAGE_RESERVE_CHARS -
      (SHOW_MAX_HISTORY_TURNS + 1) * USER_MESSAGE_RESERVE_CHARS -
      TOOL_ROUNDS_TOOL_RESULTS * TOOL_RESULT_RESERVE_CHARS) /
      REPLIES_PER_REQUEST,
  ),
);
/** The route trims each reply to TOOL_CALLS_PER_ROUND calls, so history never holds more. */
export const CHAT_MAX_TOOL_CALLS_PER_MESSAGE = TOOL_CALLS_PER_ROUND;
export const CHAT_MAX_TOOLS_BYTES = 32_768;
export const CHAT_MAX_TOOL_CALLS_BYTES = 16_384;
export const CHAT_MAX_TOOL_CALL_ID_CHARS = 256;

/** Pinned so the route picks the model it pays for instead of inheriting the provider default. */
export const CHAT_GEMINI_MODEL = "gemini-3.5-flash-lite";
