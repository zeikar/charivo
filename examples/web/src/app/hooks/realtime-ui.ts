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
 * already treats that as a barge-in. Between the two flags every case
 * `sendMessage` would refuse is anticipated, so a typed message is never
 * rejected.
 */
export function shouldInterruptBeforeSend(
  state: RealtimeState | null,
): boolean {
  if (!state) {
    return false;
  }

  return state.audioPlaying || state.awaitingResponse;
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
