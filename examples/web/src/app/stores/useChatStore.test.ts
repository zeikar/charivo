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

  /**
   * The cap notice is raised just before the session is torn down, and teardown
   * runs resetRealtimeUiState — so if that reset ever swept the notice away too,
   * a capped session would go quiet with nothing on screen explaining why.
   */
  it("keeps the cap notice through the realtime UI reset that teardown runs", () => {
    const state = useChatStore.getState();

    expect(state.capNotice).toBeNull();

    state.setCapNotice("realtime-session");
    state.resetRealtimeUiState();

    expect(useChatStore.getState().capNotice).toBe("realtime-session");

    state.setCapNotice(null);

    expect(useChatStore.getState().capNotice).toBeNull();
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

  it("clears a standing realtime error when the provider is switched", () => {
    const state = useChatStore.getState();

    state.setRealtimeError("GEMINI_API_KEY not configured");
    state.setSelectedRealtimeProvider("openai");

    expect(useChatStore.getState().realtimeError).toBeNull();
    expect(useChatStore.getState().selectedRealtimeProvider).toBe("openai");
  });

  /**
   * disableRealtimeMode runs resetRealtimeUiState on every teardown — so if
   * that reset ever swept the provider selection away too, ending a Gemini
   * call would silently drop the user back to OpenAI, and the next Talk
   * would connect to the wrong provider.
   */
  it("keeps the provider selection through the realtime UI reset that teardown runs", () => {
    const state = useChatStore.getState();

    state.setSelectedRealtimeProvider("gemini");
    state.resetRealtimeUiState();

    expect(useChatStore.getState().selectedRealtimeProvider).toBe("gemini");
  });
});
