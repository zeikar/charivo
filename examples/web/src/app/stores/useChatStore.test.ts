import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./useChatStore";

const initialState = useChatStore.getState();

describe("useChatStore realtime UI state", () => {
  beforeEach(() => {
    useChatStore.setState(initialState, true);
  });

  it("appends and resets the realtime assistant draft", () => {
    const state = useChatStore.getState();

    state.appendRealtimeAssistantDraft("Hel");
    state.appendRealtimeAssistantDraft("lo");

    expect(useChatStore.getState().realtimeAssistantDraft).toBe("Hello");

    state.setRealtimeAssistantDraft(null);

    expect(useChatStore.getState().realtimeAssistantDraft).toBeNull();
  });

  it("moves a live draft into the interrupted draft once", () => {
    const state = useChatStore.getState();

    state.appendRealtimeAssistantDraft("Partial reply");
    state.moveRealtimeDraftToInterrupted();
    state.moveRealtimeDraftToInterrupted();

    expect(useChatStore.getState().realtimeAssistantDraft).toBeNull();
    expect(useChatStore.getState().realtimeInterruptedDraft).toBe(
      "Partial reply",
    );
  });

  it("stores and resets the realtime turn status", () => {
    const state = useChatStore.getState();

    state.setRealtimeTurnStatus("responding");
    state.setRealtimeInterruptedDraft("Interrupted reply");

    expect(useChatStore.getState().realtimeTurnStatus).toBe("responding");

    state.resetRealtimeUiState();

    expect(useChatStore.getState().realtimeAssistantDraft).toBeNull();
    expect(useChatStore.getState().realtimeInterruptedDraft).toBeNull();
    expect(useChatStore.getState().realtimeTurnStatus).toBe("idle");
  });
});
