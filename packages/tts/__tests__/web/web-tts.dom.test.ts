import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TTSOptions } from "@charivo/core";
import { createWebTTSPlayer } from "@charivo/tts/web";

const speech = window.speechSynthesis as unknown as {
  speaking: boolean;
  pending: boolean;
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  speech.speaking = false;
  speech.pending = false;
  speech.cancel.mockClear();
  speech.speak.mockClear();
  speech.getVoices.mockReset();
  speech.getVoices.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

type Settled = "pending" | "resolved" | "rejected";

// The browser accepts the utterance but never reports its end on its own, so
// each test fires (or withholds) onend/onerror itself.
function speakWithoutEnd(
  player: ReturnType<typeof createWebTTSPlayer>,
  text: string,
  options?: TTSOptions,
) {
  speech.speak.mockImplementationOnce(() => undefined);
  const promise = player.speak(text, options);
  const utterance = speech.speak.mock.calls.at(
    -1,
  )![0] as SpeechSynthesisUtterance;
  const outcome: { state: Settled; error?: unknown } = { state: "pending" };
  promise.then(
    () => {
      outcome.state = "resolved";
    },
    (error: unknown) => {
      outcome.state = "rejected";
      outcome.error = error;
    },
  );
  return { promise, utterance, outcome };
}

// 10 s base plus 300 ms per code point at rate 1.
const HELLO_DEADLINE_MS = 10_000 + 5 * 300;

describe("WebTTSPlayer", () => {
  it("configures utterance with provided options", async () => {
    vi.useFakeTimers();

    const voice = { name: "Alice", voiceURI: "alice" } as SpeechSynthesisVoice;
    speech.getVoices.mockReturnValue([voice]);

    const player = createWebTTSPlayer();
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

  it("applies pitch: 0 and volume: 0 without silently ignoring them", async () => {
    vi.useFakeTimers();

    const player = createWebTTSPlayer();

    const playPromise = player.speak("mute", { pitch: 0, volume: 0 });

    await vi.runAllTimersAsync();
    await playPromise;

    expect(speech.speak).toHaveBeenCalledTimes(1);
    const utterance = speech.speak.mock
      .calls[0]![0] as SpeechSynthesisUtterance;
    expect(utterance.pitch).toBe(0);
    expect(utterance.volume).toBe(0);
  });

  it("stops active speech", async () => {
    speech.speaking = true;
    speech.getVoices.mockReturnValue([]);
    const player = createWebTTSPlayer();
    await player.stop();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("stops an utterance that is still queued", async () => {
    // A browser can hold an utterance before it starts speaking (Firefox does
    // while voices load); stop() must cancel it or it plays later.
    speech.pending = true;
    const player = createWebTTSPlayer();
    await player.stop();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("clears a queued utterance before speaking a new one", () => {
    speech.pending = true;
    const player = createWebTTSPlayer();
    void player.speak("next line");
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("does not cancel when nothing is speaking or queued", async () => {
    const player = createWebTTSPlayer();
    await player.stop();
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  describe("speech deadline", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("cancels and rejects an utterance that never ends, at exactly the deadline", async () => {
      const player = createWebTTSPlayer();
      const { outcome } = speakWithoutEnd(player, "hello");
      speech.speaking = true;

      await vi.advanceTimersByTimeAsync(HELLO_DEADLINE_MS - 1);
      expect(outcome.state).toBe("pending");
      expect(speech.cancel).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(speech.cancel).toHaveBeenCalledTimes(1);
      expect(outcome.state).toBe("rejected");
      expect((outcome.error as Error).message).toMatch(/timed out after 12 s/);
    });

    it("counts code points, not UTF-16 units", async () => {
      const player = createWebTTSPlayer();
      // Two emoji: two code points, four UTF-16 units.
      const { outcome } = speakWithoutEnd(player, "\u{1F600}\u{1F600}");

      await vi.advanceTimersByTimeAsync(10_000 + 2 * 300 - 1);
      expect(outcome.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome.state).toBe("rejected");
    });

    it("scales the per-character part by a slow rate", async () => {
      const player = createWebTTSPlayer();
      const { outcome } = speakWithoutEnd(player, "hello", { rate: 0.5 });

      await vi.advanceTimersByTimeAsync(10_000 + 5 * 600 - 1);
      expect(outcome.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome.state).toBe("rejected");
    });

    it("keeps the unscaled 10 s base at a very fast rate", async () => {
      const player = createWebTTSPlayer();
      // Clamped to 10, so the per-character part is 30 ms.
      const { outcome } = speakWithoutEnd(player, "hello", { rate: 20 });

      await vi.advanceTimersByTimeAsync(10_000 + 5 * 30 - 1);
      expect(outcome.state).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome.state).toBe("rejected");
    });

    it("leaves no deadline armed when the browser throws on speak", async () => {
      const player = createWebTTSPlayer();
      speech.speak.mockImplementationOnce(() => {
        throw new Error("speak failed");
      });

      await expect(player.speak("hello")).rejects.toThrow("speak failed");
      expect(vi.getTimerCount()).toBe(0);

      // The next utterance is unaffected: nothing stale to disarm or cancel.
      speech.speaking = true;
      const next = speakWithoutEnd(player, "hello");
      expect(speech.cancel).toHaveBeenCalledTimes(1);
      next.utterance.onend?.({} as SpeechSynthesisEvent);
      await expect(next.promise).resolves.toBeUndefined();
    });

    it("resolves on end before the deadline and leaves no timer", async () => {
      const player = createWebTTSPlayer();
      const { promise, utterance } = speakWithoutEnd(player, "hello");

      await vi.advanceTimersByTimeAsync(1_000);
      utterance.onend?.({} as SpeechSynthesisEvent);

      await expect(promise).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("settles a pending speak on stop and never fires its deadline later", async () => {
      const player = createWebTTSPlayer();
      const { promise, outcome } = speakWithoutEnd(player, "hello");
      speech.speaking = true;

      await player.stop();
      await expect(promise).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);

      speech.cancel.mockClear();
      await vi.advanceTimersByTimeAsync(HELLO_DEADLINE_MS * 2);
      expect(speech.cancel).not.toHaveBeenCalled();
      expect(outcome.state).toBe("resolved");
    });

    it("settles a superseded utterance, whose old deadline and late events leave the new one alone", async () => {
      const player = createWebTTSPlayer();
      const a = speakWithoutEnd(player, "hello");

      await vi.advanceTimersByTimeAsync(1_000);
      const b = speakWithoutEnd(player, "hello");
      speech.speaking = true;

      await vi.advanceTimersByTimeAsync(0);
      expect(a.outcome.state).toBe("resolved");

      // A's deadline passes while B is still speaking.
      speech.cancel.mockClear();
      await vi.advanceTimersByTimeAsync(HELLO_DEADLINE_MS - 1_000);
      expect(speech.cancel).not.toHaveBeenCalled();
      expect(b.outcome.state).toBe("pending");

      // A's late events, as a browser fires them after the cancel.
      a.utterance.onerror?.({
        error: "interrupted",
      } as SpeechSynthesisErrorEvent);
      a.utterance.onend?.({} as SpeechSynthesisEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(b.outcome.state).toBe("pending");

      b.utterance.onend?.({} as SpeechSynthesisEvent);
      await expect(b.promise).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("still rejects on an error event with the browser's error", async () => {
      const player = createWebTTSPlayer();
      const { promise, utterance } = speakWithoutEnd(player, "hello");

      utterance.onerror?.({
        error: "synthesis-failed",
      } as SpeechSynthesisErrorEvent);

      await expect(promise).rejects.toThrow("TTS Error: synthesis-failed");
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it("warns when voice is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    speech.getVoices.mockReturnValue([]);

    const player = createWebTTSPlayer();
    player.setVoice("unknown");

    expect(warn).toHaveBeenCalledWith('Voice "unknown" not found');
    warn.mockRestore();
  });

  it("detects support based on speech synthesis availability", () => {
    const player = createWebTTSPlayer();
    expect(player.isSupported()).toBe(true);
  });
});
