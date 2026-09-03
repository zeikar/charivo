import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => {
  const generateSpeech = vi.fn(async () => new ArrayBuffer(8));
  const setVoice = vi.fn();
  const createGeminiTTSProvider = vi.fn(() => ({
    generateSpeech,
    setVoice,
  }));
  return { generateSpeech, setVoice, createGeminiTTSProvider };
});

vi.mock("../../src/gemini/provider", () => ({
  createGeminiTTSProvider: providerMocks.createGeminiTTSProvider,
}));

import { createGeminiTTSPlayer } from "@charivo/tts/gemini";

const originalAudio = globalThis.Audio;

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  providerMocks.generateSpeech.mockClear();
  providerMocks.setVoice.mockClear();
  providerMocks.createGeminiTTSProvider.mockClear();
});

afterEach(() => {
  globalThis.Audio = originalAudio;
  vi.restoreAllMocks();
});

describe("GeminiTTSPlayer", () => {
  it("exposes audio playback mode and mime type", () => {
    const player = createGeminiTTSPlayer({ apiKey: "key" });
    expect(player.playbackMode).toBe("audio");
    expect(player.audioMimeType).toBe("audio/wav");
  });

  it("constructs the provider with dangerouslyAllowBrowser enabled", () => {
    createGeminiTTSPlayer({ apiKey: "key" });
    expect(providerMocks.createGeminiTTSProvider).toHaveBeenCalledWith({
      apiKey: "key",
      dangerouslyAllowBrowser: true,
    });
  });

  it("delegates generateAudio to the provider", async () => {
    const player = createGeminiTTSPlayer({ apiKey: "key" });
    if (!player.generateAudio) {
      throw new Error("expected GeminiTTSPlayer to implement generateAudio");
    }
    const buffer = await player.generateAudio("hello", { voice: "Puck" });

    expect(providerMocks.generateSpeech).toHaveBeenCalledWith("hello", {
      voice: "Puck",
    });
    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("fetches speech data and plays audio", async () => {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const audioInstance = {
      volume: 0,
      currentTime: 0,
      play,
      pause,
      onended: null as ((event?: Event) => void) | null,
      onerror: null as ((event?: Event) => void) | null,
    } as unknown as HTMLAudioElement;

    const audioMock = vi.fn(() => audioInstance);
    globalThis.Audio = audioMock as unknown as typeof Audio;

    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    const player = createGeminiTTSPlayer({ apiKey: "key" });
    const speakPromise = player.speak("hello", {
      voice: "Puck",
      rate: 1.2,
      volume: 0.5,
    });

    await flushAsync();
    await flushAsync();
    audioInstance.onended?.(new Event("ended"));
    await speakPromise;

    expect(providerMocks.generateSpeech).toHaveBeenCalledWith("hello", {
      voice: "Puck",
      rate: 1.2,
      volume: 0.5,
    });
    expect(audioMock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalled();
    expect(audioInstance.volume).toBe(0.5);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it("revokes the object URL and rejects when playback is blocked", async () => {
    const playError = new DOMException("blocked", "NotAllowedError");
    const play = vi.fn(() => Promise.reject(playError));
    const pause = vi.fn();
    const audioInstance = {
      volume: 0,
      currentTime: 0,
      play,
      pause,
      onended: null as ((event?: Event) => void) | null,
      onerror: null as ((event?: Event) => void) | null,
    } as unknown as HTMLAudioElement;

    const audioMock = vi.fn(() => audioInstance);
    globalThis.Audio = audioMock as unknown as typeof Audio;

    const createdUrl = "blob:mock-url";
    vi.spyOn(URL, "createObjectURL").mockReturnValue(createdUrl);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    const player = createGeminiTTSPlayer({ apiKey: "key" });

    await expect(player.speak("hello", { voice: "Puck" })).rejects.toBe(
      playError,
    );
    expect(revokeSpy).toHaveBeenCalledWith(createdUrl);
  });

  it("delegates voice changes to provider", () => {
    const player = createGeminiTTSPlayer({ apiKey: "key" });
    player.setVoice("Puck");
    expect(providerMocks.setVoice).toHaveBeenCalledWith("Puck");
  });
});
