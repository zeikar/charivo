import type { TTSPlayer } from "@charivo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPEECH_BASE_MS,
  SPEECH_MAX_MS,
  SPEECH_PER_CHAR_MS,
  speechDeadlineMs,
  withSpeechDeadline,
} from "./speech-deadline";

function fakePlayer(speak: TTSPlayer["speak"], stop?: TTSPlayer["stop"]) {
  return {
    playbackMode: "web-speech",
    speak: vi.fn(speak),
    stop: vi.fn(stop ?? (async () => {})),
    setVoice: vi.fn(),
    isSupported: () => true,
  } as unknown as TTSPlayer & {
    speak: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("speechDeadlineMs", () => {
  it("is a base plus time per character, capped", () => {
    expect(speechDeadlineMs("")).toBe(SPEECH_BASE_MS);
    expect(speechDeadlineMs("x".repeat(100))).toBe(
      SPEECH_BASE_MS + 100 * SPEECH_PER_CHAR_MS,
    );
    expect(speechDeadlineMs("x".repeat(10_000))).toBe(SPEECH_MAX_MS);
  });
});

describe("withSpeechDeadline", () => {
  it("resolves when speech ends in time, without stopping it", async () => {
    const player = fakePlayer(
      () => new Promise((resolve) => setTimeout(resolve, 3_000)),
    );
    const wrapped = withSpeechDeadline(player);
    const done = wrapped.speak("hello");
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(SPEECH_MAX_MS);
    expect(player.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a speak error through", async () => {
    const wrapped = withSpeechDeadline(
      fakePlayer(() => Promise.reject(new Error("no voice"))),
    );
    await expect(wrapped.speak("hi")).rejects.toThrow("no voice");
  });

  it("stops the speech and then rejects when it never finishes", async () => {
    const order: string[] = [];
    const player = fakePlayer(
      () => new Promise(() => {}),
      async () => {
        order.push("stop");
      },
    );
    const wrapped = withSpeechDeadline(player);
    const done = wrapped.speak("hello").catch((error: Error) => {
      order.push(`reject: ${error.message}`);
    });

    await vi.advanceTimersByTimeAsync(speechDeadlineMs("hello") - 1);
    expect(player.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(order).toEqual([
      "stop",
      "reject: Speech timed out after 11 s without finishing",
    ]);
  });

  it("still rejects, naming the failure, when the stop itself fails", async () => {
    const wrapped = withSpeechDeadline(
      fakePlayer(
        () => new Promise(() => {}),
        () => Promise.reject(new Error("synthesis gone")),
      ),
    );
    const done = wrapped.speak("hi");
    const assertion = expect(done).rejects.toThrow(
      /stopping it failed: synthesis gone/,
    );
    await vi.advanceTimersByTimeAsync(SPEECH_MAX_MS);
    await assertion;
  });

  it("does not let an interrupted utterance's deadline stop a later one", async () => {
    // Neither utterance ever gets a browser callback.
    const player = fakePlayer(() => new Promise(() => {}));
    const wrapped = withSpeechDeadline(player);
    const a = wrapped.speak("a");
    await wrapped.stop();
    await expect(a).resolves.toBeUndefined();
    player.stop.mockClear();

    await vi.advanceTimersByTimeAsync(5_000);
    let bSettled = false;
    void wrapped.speak("b").then(
      () => (bSettled = true),
      () => (bSettled = true),
    );
    // Past A's deadline (10.15 s from 0), inside B's (15 s + 10.15 s).
    await vi.advanceTimersByTimeAsync(6_000);
    expect(player.stop).not.toHaveBeenCalled();
    expect(bSettled).toBe(false);
  });

  it("delegates the rest of the player", () => {
    const player = fakePlayer(async () => {});
    const wrapped = withSpeechDeadline(player);
    wrapped.setVoice("v");
    expect(player.setVoice).toHaveBeenCalledWith("v");
    expect(wrapped.playbackMode).toBe("web-speech");
    expect(wrapped.isSupported()).toBe(true);
  });
});
