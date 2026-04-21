import type { Character, RealtimeState } from "@charivo/core";
import { describe, expect, it } from "vitest";
import {
  createRealtimeAssistantMessage,
  getRealtimeTurnStatus,
  shouldResetRealtimeUiState,
} from "./realtime-ui";

function createState(overrides: Partial<RealtimeState> = {}): RealtimeState {
  const { session, response, ...rest } = overrides;
  const mergedSession = {
    status: "active" as const,
    config: null,
    ...session,
  };
  const mergedResponse = {
    status: "idle" as const,
    text: "",
    ...response,
  };

  return {
    connection: "connected",
    session: mergedSession,
    response: mergedResponse,
    lastError: null,
    ...rest,
  };
}

describe("realtime-ui", () => {
  it("returns connecting during initial session connect", () => {
    expect(
      getRealtimeTurnStatus(
        createState({
          connection: "connecting",
          session: {
            status: "starting",
            config: null,
          },
        }),
      ),
    ).toBe("connecting");
  });

  it("returns reconnecting during refresh without resetting UI state", () => {
    expect(
      getRealtimeTurnStatus(
        createState({
          connection: "disconnecting",
        }),
        { isRefreshing: true },
      ),
    ).toBe("reconnecting");
    expect(
      shouldResetRealtimeUiState(
        createState({
          connection: "disconnecting",
        }),
        { isRefreshing: true },
      ),
    ).toBe(false);
  });

  it("returns responding for streamed assistant output", () => {
    expect(
      getRealtimeTurnStatus(
        createState({
          response: {
            status: "responding",
            text: "Hi",
          },
        }),
      ),
    ).toBe("responding");
  });

  it("returns interrupted after interruption", () => {
    expect(
      getRealtimeTurnStatus(
        createState({
          response: {
            status: "interrupted",
            text: "Par",
          },
        }),
      ),
    ).toBe("interrupted");
  });

  it("creates a character message for completed realtime assistant text", () => {
    const character: Character = {
      id: "char-1",
      name: "Hiyori",
    };

    const message = createRealtimeAssistantMessage("Hello there", character);

    expect(message.content).toBe("Hello there");
    expect(message.type).toBe("character");
    expect(message.characterId).toBe("char-1");
    expect(message.character).toEqual(character);
    expect(message.timestamp).toBeInstanceOf(Date);
    expect(message.id).toBeTruthy();
  });
});
