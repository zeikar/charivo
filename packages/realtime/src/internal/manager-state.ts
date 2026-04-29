import type { RealtimeSessionConfig, RealtimeState } from "@charivo/core";

let nextFallbackSessionId = 1;

export function mergeSessionConfig(
  baseConfig?: Omit<RealtimeSessionConfig, "tools">,
  overrideConfig?: RealtimeSessionConfig,
): RealtimeSessionConfig | undefined {
  if (!baseConfig && !overrideConfig) {
    return undefined;
  }

  const { tools: _ignoredOverrideTools, ...overrideWithoutTools } =
    overrideConfig ?? {};

  return {
    ...baseConfig,
    ...overrideWithoutTools,
  };
}

export function mergeRealtimeState(
  current: RealtimeState,
  partial: Partial<RealtimeState>,
): RealtimeState {
  return {
    connection: partial.connection ?? current.connection,
    session: {
      status: partial.session?.status ?? current.session.status,
      config: partial.session?.config ?? current.session.config,
      characterId: partial.session?.characterId ?? current.session.characterId,
    },
    response: {
      status: partial.response?.status ?? current.response.status,
      text: partial.response?.text ?? current.response.text,
    },
    lastError: partial.lastError ?? current.lastError,
  };
}

export function createRealtimeSessionId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  return `realtime-session-${Date.now()}-${nextFallbackSessionId++}`;
}
