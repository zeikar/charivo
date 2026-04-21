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

  if (state.response.status === "responding") {
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
