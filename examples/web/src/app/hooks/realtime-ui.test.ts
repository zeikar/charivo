import { describe, expect, it } from "vitest";
import type { RealtimeState } from "@charivo/core";
import {
  createRealtimeAssistantMessage,
  getRealtimeTurnStatus,
  shouldResetRealtimeUiState,
} from "./realtime-ui";

function createRealtimeState(
  overrides?: Partial<RealtimeState>,
): RealtimeState {
  const session = {
    status: "active" as const,
    config: null,
    characterId: "char-1",
    ...overrides?.session,
  };
  const response = {
    status: "idle" as const,
    text: "",
    ...overrides?.response,
  };
  const connection = overrides?.connection ?? "connected";
  const lastError = overrides?.lastError ?? null;

  const state: RealtimeState = {
    connection,
    session,
    response,
    lastError,
  };

  return state;
}

describe("realtime-ui helpers", () => {
  it("derives turn status from realtime state", () => {
    expect(getRealtimeTurnStatus(null)).toBe("idle");
    expect(
      getRealtimeTurnStatus(
        createRealtimeState({ response: { status: "responding", text: "hi" } }),
      ),
    ).toBe("responding");
    expect(getRealtimeTurnStatus(createRealtimeState())).toBe("listening");
    expect(
      getRealtimeTurnStatus(
        createRealtimeState({
          connection: "idle",
          session: { status: "stopped", config: null },
        }),
      ),
    ).toBe("idle");
  });

  it("signals when realtime UI state should reset", () => {
    expect(shouldResetRealtimeUiState(createRealtimeState())).toBe(false);
    expect(
      shouldResetRealtimeUiState(
        createRealtimeState({
          connection: "error",
          session: { status: "stopped", config: null },
        }),
      ),
    ).toBe(true);
  });

  it("creates finalized realtime assistant messages", () => {
    const message = createRealtimeAssistantMessage("Hello", {
      id: "char-1",
      name: "Hiyori",
    });

    expect(message.id).toBeTruthy();
    expect(message.content).toBe("Hello");
    expect(message.type).toBe("character");
    expect(message.characterId).toBe("char-1");
    expect(message.character?.name).toBe("Hiyori");
  });
});
