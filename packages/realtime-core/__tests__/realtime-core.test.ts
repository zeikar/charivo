import { describe, expect, it, vi } from "vitest";
import type { CharivoEventEmitter } from "@charivo/core";
import {
  createRealtimeManager,
  getEmotionSessionConfig,
  setEmotionTool,
  type RealtimeClient,
} from "@charivo/realtime-core";

function createRealtimeClientStub() {
  let textDeltaHandler: ((text: string) => void) | undefined;
  let audioDoneHandler: (() => void) | undefined;
  let toolCallHandler:
    | ((name: string, args: Record<string, unknown>) => void)
    | undefined;
  let errorHandler: ((error: Error) => void) | undefined;
  let lipSyncHandler: ((rms: number) => void) | undefined;

  const client: RealtimeClient = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    sendText: vi.fn(async () => undefined),
    sendAudio: vi.fn(async () => undefined),
    onTextDelta: vi.fn((callback) => {
      textDeltaHandler = callback;
    }),
    onAudioDelta: vi.fn(() => undefined),
    onLipSyncUpdate: vi.fn((callback) => {
      lipSyncHandler = callback;
    }),
    onAudioDone: vi.fn((callback) => {
      audioDoneHandler = callback;
    }),
    onToolCall: vi.fn((callback) => {
      toolCallHandler = callback;
    }),
    onError: vi.fn((callback) => {
      errorHandler = callback;
    }),
  };

  return {
    client,
    emitTextDelta: (text: string) => textDeltaHandler?.(text),
    emitAudioDone: () => audioDoneHandler?.(),
    emitToolCall: (name: string, args: Record<string, unknown>) =>
      toolCallHandler?.(name, args),
    emitError: (error: Error) => errorHandler?.(error),
    emitLipSync: (rms: number) => lipSyncHandler?.(rms),
  };
}

describe("realtime-core", () => {
  it("forwards session config and relays realtime events", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter: CharivoEventEmitter = {
      emit: vi.fn(),
    };

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      model: "gpt-realtime-mini",
      voice: "marin",
    });
    await manager.sendMessage("hello");

    stub.emitTextDelta("hel");
    stub.emitToolCall("setEmotion", { emotion: "happy" });
    stub.emitLipSync(0.4);
    stub.emitAudioDone();
    stub.emitError(new Error("boom"));

    expect(stub.client.connect).toHaveBeenCalledWith({
      model: "gpt-realtime-mini",
      voice: "marin",
    });
    expect(stub.client.sendText).toHaveBeenCalledWith("hello");
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:text:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:emotion", {
      emotion: "happy",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("tts:lipsync:update", {
      rms: 0.4,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("tts:audio:end", {});
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:error", {
      error: expect.any(Error),
    });
  });

  it("injects setEmotion only once into the default session config", () => {
    const config = getEmotionSessionConfig({
      tools: [setEmotionTool],
    });

    expect(config.model).toBe("gpt-realtime-mini");
    expect(config.audio.output.voice).toBe("marin");
    expect(
      config.tools.filter((tool) => tool.name === "setEmotion"),
    ).toHaveLength(1);
  });
});
