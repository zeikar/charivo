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

/**
 * Whether a typed message has to interrupt before it can be sent.
 *
 * Speaking over the character already works — server VAD treats it as a
 * barge-in and cuts the reply short. Typing means the same thing, so it takes
 * the turn the same way instead of being rejected with "Response already in
 * progress".
 *
 * This does not cover the window between sending and the reply starting, which
 * `RealtimeManager` also locks but does not expose in its state. A send landing
 * there is a genuine double-send and is still refused.
 */
export function shouldInterruptBeforeSend(
  state: RealtimeState | null,
): boolean {
  return state?.response.status === "responding";
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
