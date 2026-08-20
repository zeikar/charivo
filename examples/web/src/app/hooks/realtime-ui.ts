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
 * Whether a typed message has to interrupt before it can be sent.
 *
 * Speaking over the character already works — server VAD treats it as a
 * barge-in and cuts the reply short. Typing means the same thing, so it takes
 * the turn the same way instead of being rejected with "Response already in
 * progress".
 *
 * `audioPlaying` is not redundant with the response status, it is the more
 * important half. The response completes when the provider finishes SENDING
 * audio, and playback runs well past that — a message typed in that window
 * found the turn already "completed", skipped the interrupt, and queued behind
 * the still-playing line, so the character finished the old sentence and only
 * then answered.
 *
 * Neither signal covers the window between sending and the reply starting,
 * which `RealtimeManager` also locks but does not expose. A send landing there
 * is a genuine double-send and is still refused.
 */
export function shouldInterruptBeforeSend(
  state: RealtimeState | null,
): boolean {
  if (!state) {
    return false;
  }

  return state.audioPlaying || state.response.status === "responding";
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
