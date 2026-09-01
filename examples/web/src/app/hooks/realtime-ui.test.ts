import type { Character, RealtimeState } from "@charivo/core";
import { describe, expect, it } from "vitest";
import {
  createRealtimeAssistantMessage,
  getRealtimeTurnStatus,
  shouldInterruptBeforeSend,
  shouldResetRealtimeUiState,
  toRealtimeErrorMessage,
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
    audioPlaying: false,
    // The manager derives this from the response status, so a fixture that sets
    // "responding" without it would be a state the manager cannot produce.
    awaitingResponse: mergedResponse.status === "responding",
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
  // Playback outlives the response, so the status must not fall back to
  // "listening" while the character is still audibly talking.
  it("stays responding while audio plays on after the response completed", () => {
    expect(
      getRealtimeTurnStatus(
        createState({
          response: { status: "completed", text: "done" },
          audioPlaying: true,
        }),
      ),
    ).toBe("responding");
  });
});

describe("shouldInterruptBeforeSend", () => {
  it("interrupts while the reply is still being generated", () => {
    expect(
      shouldInterruptBeforeSend(
        createState({ response: { status: "responding", text: "hi" } }),
      ),
    ).toBe(true);
  });

  // The response completes when the provider stops SENDING; the speakers are
  // still going. Skipping the interrupt here let the old line play out and the
  // new answer queue behind it instead of cutting in.
  it("interrupts while audio is still playing after the response completed", () => {
    expect(
      shouldInterruptBeforeSend(
        createState({
          response: { status: "completed", text: "done" },
          audioPlaying: true,
        }),
      ),
    ).toBe(true);
  });

  // The gap between a message going out and its reply starting: the response
  // status still reads "idle", but a send would be refused.
  it("interrupts while a sent message is still unanswered", () => {
    expect(
      shouldInterruptBeforeSend(
        createState({
          response: { status: "idle", text: "" },
          awaitingResponse: true,
        }),
      ),
    ).toBe(true);
  });

  it("sends straight through once nothing is generating or playing", () => {
    for (const status of ["idle", "completed", "interrupted"] as const) {
      expect(
        shouldInterruptBeforeSend(
          createState({ response: { status, text: "" } }),
        ),
      ).toBe(false);
    }
  });

  it("does not interrupt without a session", () => {
    expect(shouldInterruptBeforeSend(null)).toBe(false);
  });
});

describe("toRealtimeErrorMessage", () => {
  it("unwraps the route's error line out of the bootstrap envelope", () => {
    expect(
      toRealtimeErrorMessage(
        new Error(
          'Failed to create Realtime session: {"error":"GEMINI_API_KEY not configured"}',
        ),
      ),
    ).toBe("GEMINI_API_KEY not configured");
  });

  // The catch-all response carries a generic "error" plus the real cause in
  // "details", so showing "error" would hide what actually went wrong.
  it("prefers the envelope's details over its generic error", () => {
    expect(
      toRealtimeErrorMessage(
        new Error(
          'Failed to create Realtime session: {"error":"Failed to create Realtime session","details":"model not found"}',
        ),
      ),
    ).toBe("model not found");
  });

  // The envelope is untrusted: `details` being present is not `details` being
  // usable, and the empty case is the one where unwrapping would leave the UI
  // with a falsy error and no notice at all.
  it("falls back to the envelope's error when details is not a string", () => {
    expect(
      toRealtimeErrorMessage(
        new Error(
          'Failed to create Realtime session: {"error":"real cause","details":{"code":429}}',
        ),
      ),
    ).toBe("real cause");
  });

  it("falls back to the envelope's error when details is empty", () => {
    expect(
      toRealtimeErrorMessage(
        new Error(
          'Failed to create Realtime session: {"error":"real cause","details":""}',
        ),
      ),
    ).toBe("real cause");
  });

  it("passes a message through when there is no JSON envelope to unwrap", () => {
    expect(toRealtimeErrorMessage(new Error("Realtime request failed"))).toBe(
      "Realtime request failed",
    );
    // A proxy or gateway can answer with HTML instead of the route's JSON.
    expect(
      toRealtimeErrorMessage(
        new Error("Failed to create Realtime session: <html>502</html>"),
      ),
    ).toBe("Failed to create Realtime session: <html>502</html>");
  });

  it("reports a non-Error throw as an unknown error", () => {
    expect(toRealtimeErrorMessage("boom")).toBe("Unknown error");
  });
});
