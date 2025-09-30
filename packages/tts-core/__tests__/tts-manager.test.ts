import { describe, it, expect, vi } from "vitest";
import { TTSManager, createTTSManager } from "../src/tts-manager";

describe("TTSManager", () => {
  it("should create TTS manager with TTS player", () => {
    const mockTTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setVoice: vi.fn(),
      isSupported: vi.fn().mockReturnValue(true),
    };

    const manager = createTTSManager(mockTTSPlayer);
    expect(manager).toBeInstanceOf(TTSManager);
  });

  it("should delegate calls to wrapped TTS player", async () => {
    const mockTTSPlayer = {
      speak: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setVoice: vi.fn(),
      isSupported: vi.fn().mockReturnValue(true),
    };

    const manager = createTTSManager(mockTTSPlayer);

    await manager.speak("Hello", { volume: 0.8 });
    expect(mockTTSPlayer.speak).toHaveBeenCalledWith("Hello", { volume: 0.8 });

    await manager.stop();
    expect(mockTTSPlayer.stop).toHaveBeenCalled();

    manager.setVoice("en-US");
    expect(mockTTSPlayer.setVoice).toHaveBeenCalledWith("en-US");

    const supported = manager.isSupported();
    expect(mockTTSPlayer.isSupported).toHaveBeenCalled();
    expect(supported).toBe(true);
  });
});
