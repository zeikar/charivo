import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => {
  const generateSpeech = vi.fn(async () => new ArrayBuffer(8));
  const setVoice = vi.fn();
  const createOpenAITTSProvider = vi.fn(() => ({
    generateSpeech,
    setVoice,
  }));
  return { generateSpeech, setVoice, createOpenAITTSProvider };
});

vi.mock("@charivo/tts-provider-openai", () => ({
  createOpenAITTSProvider: providerMocks.createOpenAITTSProvider,
}));

import { OpenAITTSPlayer } from "@charivo/tts-player-openai";

const originalAudio = globalThis.Audio;

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  providerMocks.generateSpeech.mockClear();
  providerMocks.setVoice.mockClear();
  providerMocks.createOpenAITTSProvider.mockClear();
});

afterEach(() => {
  globalThis.Audio = originalAudio;
  vi.restoreAllMocks();
});

describe("OpenAITTSPlayer", () => {
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

    const player = new OpenAITTSPlayer({ apiKey: "key" });
    const speakPromise = player.speak("hello", {
      voice: "alloy",
      rate: 1.2,
      volume: 0.5,
    });

    await flushAsync();
    await flushAsync();
    audioInstance.onended?.(new Event("ended"));
    await speakPromise;

    expect(providerMocks.generateSpeech).toHaveBeenCalledWith("hello", {
      voice: "alloy",
      rate: 1.2,
      volume: 0.5,
    });
    expect(audioMock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalled();
    expect(audioInstance.volume).toBe(0.5);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it("delegates voice changes to provider", () => {
    const player = new OpenAITTSPlayer({ apiKey: "key" });
    player.setVoice("nova");
    expect(providerMocks.setVoice).toHaveBeenCalledWith("nova");
  });
});
