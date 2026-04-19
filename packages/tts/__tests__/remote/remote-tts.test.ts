import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteTTSPlayer } from "@charivo/tts/remote";

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;
const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  vi.useRealTimers();
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

  it("stop does nothing (stateless player)", async () => {
    const player = new RemoteTTSPlayer();

    // stop() should not throw and should complete immediately
    await expect(player.stop()).resolves.toBeUndefined();
  });

  it("throws when API fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("fail", { status: 500, statusText: "Server" }),
    ) as typeof fetch;

    const player = new RemoteTTSPlayer();
    await expect(player.speak("hi")).rejects.toThrow("TTS API failed: Server");
  });

  it("throws a timeout-specific error when audio generation stalls", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const player = new RemoteTTSPlayer();
    const request = player.generateAudio("hello");
    const expectation = expect(request).rejects.toThrow(
      "TTS request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("revokes object URLs when playback fails", async () => {
    const buffer = new ArrayBuffer(4);
    globalThis.fetch = vi.fn(async () => new Response(buffer)) as typeof fetch;

    const audioInstance = {
      volume: 1,
      currentTime: 0,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      onended: null as ((event?: Event) => void) | null,
      onerror: null as ((event?: Event) => void) | null,
    } as unknown as HTMLAudioElement;

    globalThis.Audio = vi.fn(() => audioInstance) as unknown as typeof Audio;
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");

    const player = new RemoteTTSPlayer();
    const speakPromise = player.speak("hello");

    await flushAsync();
    audioInstance.onerror?.(new Event("error"));

    await expect(speakPromise).rejects.toThrow("Audio playback failed");
    expect(revokeSpy).toHaveBeenCalled();
  });
});
