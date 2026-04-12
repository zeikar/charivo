import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Character,
  CharivoEventEmitter,
  RealtimeState,
  RealtimeToolRegistration,
} from "@charivo/core";
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
  setEmotionRealtimeTool,
  setEmotionTool,
  type RealtimeTransportClient,
  type RealtimeTransportEvent,
} from "@charivo/realtime-core";

function createRealtimeClientStub() {
  const eventHandlers = new Set<
    (event: RealtimeTransportEvent) => void | Promise<void>
  >();

  const client: RealtimeTransportClient = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    sendText: vi.fn(async () => undefined),
    sendAudio: vi.fn(async () => undefined),
    sendToolResult: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    onEvent: vi.fn((callback) => {
      eventHandlers.add(callback);
    }),
  };

  return {
    client,
    emit: async (event: RealtimeTransportEvent) => {
      for (const handler of eventHandlers) {
        await handler(event);
      }
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("realtime-core", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("builds character-aware session config without auto-injecting tools", () => {
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
    });

    expect(config.provider).toBe("openai");
    expect(config.transport).toBe("webrtc");
    expect(config.model).toBe("gpt-realtime-mini");
    expect(config.voice).toBe("alloy");
    expect(config.instructions).toContain("Hiyori");
    expect(config.tools).toBeUndefined();
  });

  it("starts with registry tools and executes built-in and custom handlers", async () => {
    const stub = createRealtimeClientStub();
    const describeSceneTool: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "describeScene",
        description: "Describe the current scene context.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(async (_args, context) => ({
        success: true,
        characterId: context.character?.id ?? null,
        responseStatus: context.state.response.status,
      })),
    };
    const manager = createRealtimeManager(stub.client, {
      tools: [describeSceneTool],
    });
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

    expect(manager.getRegisteredTools().map((tool) => tool.name)).toEqual([
      "setEmotion",
      "describeScene",
    ]);
    expect(stub.client.connect).toHaveBeenCalledWith({
      provider: "openai",
      transport: "webrtc",
      model: "gpt-realtime-mini",
      voice: "marin",
      instructions: expect.any(String),
      tools: [setEmotionTool, describeSceneTool.definition],
      toolChoice: "auto",
    });

    await stub.emit({
      type: "tool.call",
      name: "setEmotion",
      args: { emotion: "happy" },
      callId: "call-1",
    });
    await stub.emit({
      type: "tool.call",
      name: "describeScene",
      args: {},
      callId: "call-2",
    });

    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(1, "call-1", {
      success: true,
      emotion: "happy",
    });
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(2, "call-2", {
      success: true,
      characterId: "char-1",
      responseStatus: "idle",
    });
    expect(describeSceneTool.handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        character: expect.objectContaining({ id: "char-1" }),
        state: expect.objectContaining({
          session: expect.objectContaining({ status: "active" }),
        }),
        callId: "call-2",
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:emotion", {
      emotion: "happy",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:call", {
      name: "setEmotion",
      args: { emotion: "happy" },
      callId: "call-1",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:result", {
      name: "describeScene",
      output: {
        success: true,
        characterId: "char-1",
        responseStatus: "idle",
      },
      callId: "call-2",
    });
  });

  it("normalizes tool failures and relays transport events", async () => {
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
    });

    await manager.sendMessage("hello");
    await manager.interrupt();
    expect(manager.getState().response.status).toBe("interrupted");

    await stub.emit({ type: "assistant.response.completed", text: "" });
    expect(manager.getState().response.status).toBe("interrupted");

    await stub.emit({ type: "assistant.response.started" });
    await stub.emit({ type: "assistant.text.delta", text: "hel" });
    await stub.emit({
      type: "tool.call",
      name: "setEmotion",
      args: { emotion: "invalid" },
      callId: "call-invalid",
    });
    await stub.emit({
      type: "tool.call",
      name: "missingTool",
      args: {},
      callId: "call-missing",
    });
    await stub.emit({
      type: "tool.result",
      name: "serverTool",
      output: { success: true },
      callId: "call-server",
    });
    await stub.emit({ type: "audio.lipsync", rms: 0.4 });
    await stub.emit({ type: "audio.output.ended" });
    await stub.emit({ type: "user.transcript", text: "hello there" });
    await stub.emit({ type: "assistant.response.completed", text: "hello" });
    await stub.emit({ type: "error", error: new Error("boom") });

    expect(stub.client.sendText).toHaveBeenCalledWith("hello");
    expect(stub.client.interrupt).toHaveBeenCalledTimes(1);
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(
      1,
      "call-invalid",
      {
        success: false,
        error: 'setEmotion requires a valid "emotion" string',
      },
    );
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(
      2,
      "call-missing",
      {
        success: false,
        error: 'No realtime tool registered for "missingTool"',
      },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:assistant:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:text:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:result", {
      name: "serverTool",
      output: { success: true },
      callId: "call-server",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:error", {
      name: "setEmotion",
      error: expect.any(Error),
      callId: "call-invalid",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:error", {
      name: "missingTool",
      error: expect.any(Error),
      callId: "call-missing",
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
    expect(manager.getState().response.text).toBe("hello");
    expect(manager.getState().lastError?.message).toBe("boom");
  });

  it("times out slow tools and supports unregistering before the next session", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const slowTool: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "slowTool",
        description: "Never resolves in time.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(
        async () => await new Promise<Record<string, unknown>>(() => undefined),
      ),
      timeoutMs: 50,
    };
    const manager = createRealtimeManager(stub.client, {
      tools: [slowTool],
    });

    manager.unregisterTool(setEmotionRealtimeTool.definition.name);
    manager.registerTool(setEmotionRealtimeTool);

    await manager.startSession({
      provider: "openai",
    });

    const toolCall = stub.emit({
      type: "tool.call",
      name: "slowTool",
      args: {},
      callId: "call-timeout",
    });

    await vi.advanceTimersByTimeAsync(50);
    await toolCall;

    expect(stub.client.sendToolResult).toHaveBeenCalledWith("call-timeout", {
      success: false,
      error: 'Realtime tool "slowTool" timed out after 50ms',
    });

    await manager.stopSession();
    expect(manager.getRegisteredTools().map((tool) => tool.name)).toEqual([
      "slowTool",
      "setEmotion",
    ]);
  });

  it("merges state updates emitted by the transport client", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
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
