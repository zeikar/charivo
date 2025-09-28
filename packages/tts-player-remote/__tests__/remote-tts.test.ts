import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteTTSPlayer } from "@charivo/tts-player-remote";

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  vi.restoreAllMocks();
});

describe("RemoteTTSPlayer", () => {
  it("fetches audio and plays it", async () => {
    const buffer = new ArrayBuffer(4);
    const fetchMock = vi.fn(
      async () =>
        new Response(buffer, {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

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

    const player = new RemoteTTSPlayer({ apiEndpoint: "/api/tts" });
    const speakPromise = player.speak("hello", { volume: 2 });

    await flushAsync();
    await flushAsync();
    expect(audioMock).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audioInstance.onended).toBeTypeOf("function");

    audioInstance.onended?.(new Event("ended"));
    await speakPromise;

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(audioInstance.volume).toBe(1);
    expect(revokeSpy).toHaveBeenCalled();
  });

  it("stops and clears current audio", async () => {
    const buffer = new ArrayBuffer(2);
    globalThis.fetch = vi.fn(async () => new Response(buffer)) as typeof fetch;

    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    const audioInstance = {
      volume: 0,
      currentTime: 1,
      play,
      pause,
      onended: null as ((event?: Event) => void) | null,
      onerror: null as ((event?: Event) => void) | null,
    } as unknown as HTMLAudioElement;

    const audioMock = vi.fn(() => audioInstance);
    globalThis.Audio = audioMock as unknown as typeof Audio;

    const player = new RemoteTTSPlayer();
    const speakPromise = player.speak("hi");

    await flushAsync();
    await flushAsync();
    expect(audioMock).toHaveBeenCalledTimes(1);
    expect(audioInstance.onended).toBeTypeOf("function");

    await player.stop();

    expect(pause).toHaveBeenCalled();
    expect(audioInstance.currentTime).toBe(0);

    audioInstance.onended?.(new Event("ended"));
    await speakPromise;
  });

  it("throws when API fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("fail", { status: 500, statusText: "Server" }),
    ) as typeof fetch;

    const player = new RemoteTTSPlayer();
    await expect(player.speak("hi")).rejects.toThrow("TTS API failed: Server");
  });
});
