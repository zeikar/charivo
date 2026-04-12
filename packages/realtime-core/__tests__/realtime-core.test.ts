import { describe, expect, it, vi } from "vitest";
import type {
  Character,
  CharivoEventEmitter,
  RealtimeState,
} from "@charivo/core";
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
  setEmotionTool,
  type RealtimeTransportClient,
  type RealtimeTransportEvent,
} from "@charivo/realtime-core";

function createRealtimeClientStub() {
  let eventHandler: ((event: RealtimeTransportEvent) => void) | undefined;

  const client: RealtimeTransportClient = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    sendText: vi.fn(async () => undefined),
    sendAudio: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    onEvent: vi.fn((callback) => {
      eventHandler = callback;
    }),
  };

  return {
    client,
    emit: (event: RealtimeTransportEvent) => eventHandler?.(event),
  };
}

describe("realtime-core", () => {
  it("builds character-aware session config and injects emotion support once", () => {
    const character: Character = {
      id: "char-1",
      name: "Hiyori",
      personality: "Cheerful and helpful assistant",
      voice: {
        voiceId: "alloy",
      },
    };

    const config = buildRealtimeSessionConfig({
      character,
      baseConfig: {
        tools: [setEmotionTool],
      },
    });

    expect(config.provider).toBe("openai");
    expect(config.transport).toBe("webrtc");
    expect(config.model).toBe("gpt-realtime-mini");
    expect(config.voice).toBe("alloy");
    expect(config.instructions).toContain("Hiyori");
    expect(
      config.tools?.filter((tool) => tool.name === "setEmotion"),
    ).toHaveLength(1);
  });

  it("tracks state and relays normalized realtime events", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter: CharivoEventEmitter = {
      emit: vi.fn(),
    };

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter({
      id: "char-1",
      name: "Hiyori",
    });

    await manager.startSession({
      provider: "openai",
      model: "gpt-realtime-mini",
      voice: "marin",
    });

    let state = manager.getState();
    expect(state.connection).toBe("connected");
    expect(state.session.status).toBe("active");
    expect(state.session.characterId).toBe("char-1");

    await manager.sendMessage("hello");
    await manager.interrupt();

    state = manager.getState();
    expect(state.response.status).toBe("interrupted");

    stub.emit({ type: "assistant.response.started" });
    stub.emit({ type: "assistant.text.delta", text: "hel" });
    stub.emit({
      type: "tool.call",
      name: "setEmotion",
      args: { emotion: "happy" },
      callId: "call-1",
    });
    stub.emit({
      type: "tool.result",
      name: "setEmotion",
      output: { success: true },
      callId: "call-1",
    });
    stub.emit({ type: "audio.lipsync", rms: 0.4 });
    stub.emit({ type: "audio.output.ended" });
    stub.emit({ type: "user.transcript", text: "hello there" });
    stub.emit({ type: "assistant.response.completed", text: "hello" });
    stub.emit({ type: "error", error: new Error("boom") });

    state = manager.getState();
    expect(state.response.text).toBe("hello");
    expect(state.lastError?.message).toBe("boom");

    expect(stub.client.connect).toHaveBeenCalledWith({
      provider: "openai",
      transport: "webrtc",
      model: "gpt-realtime-mini",
      voice: "marin",
      instructions: expect.any(String),
      tools: [setEmotionTool],
      toolChoice: "auto",
    });
    expect(stub.client.sendText).toHaveBeenCalledWith("hello");
    expect(stub.client.interrupt).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:assistant:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:text:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:emotion", {
      emotion: "happy",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:call", {
      name: "setEmotion",
      args: { emotion: "happy" },
      callId: "call-1",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:result", {
      name: "setEmotion",
      output: { success: true },
      callId: "call-1",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("tts:lipsync:update", {
      rms: 0.4,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:user:transcript", {
      text: "hello there",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:error", {
      error: expect.any(Error),
    });

    await manager.stopSession();
    state = manager.getState();
    expect(state.connection).toBe("idle");
    expect(state.session.status).toBe("stopped");
  });

  it("merges state updates emitted by the transport client", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
    });

    stub.emit({
      type: "state",
      state: {
        response: {
          status: "responding",
          text: "partial",
        },
      } as Partial<RealtimeState>,
    });

    expect(manager.getState().response).toEqual({
      status: "responding",
      text: "partial",
    });
  });
});
