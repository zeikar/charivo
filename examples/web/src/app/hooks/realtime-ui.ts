import type { Character, RealtimeState } from "@charivo/core";
import type { ChatMessage, RealtimeTurnStatus } from "../types/chat";

interface RealtimeUiStatusOptions {
  isRefreshing?: boolean;
}

export function getRealtimeTurnStatus(
  state: RealtimeState | null,
  options: RealtimeUiStatusOptions = {},
): RealtimeTurnStatus {
  if (!state) {
    return "idle";
  }

  if (options.isRefreshing) {
    return "reconnecting";
  }

  if (
    state.connection === "connecting" ||
    state.session.status === "starting"
  ) {
    return "connecting";
  }

  if (state.connection !== "connected" || state.session.status !== "active") {
    return "idle";
  }

  if (state.response.status === "interrupted") {
    return "interrupted";
  }

  // Playback outlives the response, and the character is still talking for all
  // of it: the status has to say so, or the placeholder claims to be listening
  // and the stop control vanishes mid-sentence.
  if (state.response.status === "responding" || state.audioPlaying) {
    return "responding";
  }

  return "listening";
}

export function shouldResetRealtimeUiState(
  state: RealtimeState | null,
  options: RealtimeUiStatusOptions = {},
): boolean {
  return getRealtimeTurnStatus(state, options) === "idle";
}

/**
 * Typing over the character means what speaking over it means, and server VAD
 * already treats that as a barge-in. Covers the response-in-progress refusals;
 * an inactive or reconnecting session is refused on its own terms.
 */
export function shouldInterruptBeforeSend(
  state: RealtimeState | null,
): boolean {
  if (!state) {
    return false;
  }

  return state.audioPlaying || state.awaitingResponse;
}

const REALTIME_SESSION_FAILURE_PREFIX = "Failed to create Realtime session: ";

/**
 * Turns a realtime failure into something the notice bar can show.
 *
 * A failed bootstrap arrives with the route's entire response body pasted into
 * the message (`packages/realtime/src/remote/client.ts:296-300`), so the user
 * would otherwise read `Failed to create Realtime session: {"error":"..."}`.
 * Unwrapping it here keeps a presentation concern out of `@charivo/realtime`.
 *
 * `details` is tried first because the route's catch-all sends the generic line
 * as `error` and the actual cause as `details` (`api/realtime/route.ts:269-272`)
 * -- but only a non-blank string is usable, and an unusable one falls through to
 * `error` and then to the raw message. An empty `details` unwrapped as-is would
 * be worse than not unwrapping at all: `realtimeError` is read by truthiness, so
 * the UI would show no error while the session is dead.
 */
export function toRealtimeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  if (!error.message.startsWith(REALTIME_SESSION_FAILURE_PREFIX)) {
    return error.message;
  }

  try {
    const envelope = JSON.parse(
      error.message.slice(REALTIME_SESSION_FAILURE_PREFIX.length),
    ) as { error?: unknown; details?: unknown } | null;
    const unwrapped = [envelope?.details, envelope?.error].find(
      (value): value is string =>
        typeof value === "string" && value.trim() !== "",
    );

    return unwrapped ?? error.message;
  } catch {
    // Not every failing response is JSON -- a proxy or gateway can answer with
    // HTML. Showing the raw message beats showing a parse error.
    return error.message;
  }
}

export function createRealtimeAssistantMessage(
  text: string,
  character?: Character,
): ChatMessage {
  return {
    id: createRealtimeMessageId(),
    content: text,
    timestamp: new Date(),
    characterId: character?.id,
    type: "character",
    character,
  };
}

function createRealtimeMessageId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  return `realtime-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
