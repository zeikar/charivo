import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebTTSPlayer } from "@charivo/tts-player-web";

const speech = window.speechSynthesis as unknown as {
  speaking: boolean;
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  speech.speaking = false;
  speech.cancel.mockClear();
  speech.speak.mockClear();
  speech.getVoices.mockReset();
  speech.getVoices.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebTTSPlayer", () => {
  it("configures utterance with provided options", async () => {
    vi.useFakeTimers();

    const voice = { name: "Alice", voiceURI: "alice" } as SpeechSynthesisVoice;
    speech.getVoices.mockReturnValue([voice]);

    const player = new WebTTSPlayer();
    player.setVoice("Alice"); // Set voice before speaking

    const playPromise = player.speak("hello", {
      rate: 20,
      pitch: -10,
      volume: 2,
      voice: "Alice",
    });

    await vi.runAllTimersAsync();
    await playPromise;

    expect(speech.speak).toHaveBeenCalledTimes(1);
    const utterance = speech.speak.mock
      .calls[0]![0] as SpeechSynthesisUtterance;
    expect(utterance.rate).toBe(10);
    expect(utterance.pitch).toBe(0);
    expect(utterance.volume).toBe(1);
    expect(utterance.voice).toEqual(voice);
  });

  it("stops active speech", async () => {
    speech.speaking = true;
    speech.getVoices.mockReturnValue([]);
    const player = new WebTTSPlayer();
    await player.stop();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("warns when voice is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    speech.getVoices.mockReturnValue([]);

    const player = new WebTTSPlayer();
    player.setVoice("unknown");

    expect(warn).toHaveBeenCalledWith('Voice "unknown" not found');
    warn.mockRestore();
  });

  it("detects support based on speech synthesis availability", () => {
    const player = new WebTTSPlayer();
    expect(player.isSupported()).toBe(true);
  });
});
