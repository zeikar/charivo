import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoTimeoutError,
  type TTSPcmStream,
  type TTSPlayer,
} from "@charivo/core";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;
const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A stream calls `pull` on a microtask, never inside the `read()` itself. */
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

/**
 * `TTSPlayer.generateAudio` is optional, and the factory returns the interface.
 * Narrow by throwing rather than by `?.`, so a player that stopped implementing
 * it fails the test instead of quietly skipping the call.
 */
function generateAudio(player: TTSPlayer, text: string): Promise<ArrayBuffer> {
  if (!player.generateAudio) {
    throw new Error("RemoteTTSPlayer must implement generateAudio");
  }

  return player.generateAudio(text);
}

/** Same narrowing for the streaming counterpart, which is opt-in per player. */
function generateAudioStream(
  player: TTSPlayer,
  text: string,
  signal?: AbortSignal,
): Promise<TTSPcmStream> {
  if (!player.generateAudioStream) {
    throw new Error(
      "streaming RemoteTTSPlayer must implement generateAudioStream",
    );
  }

  return player.generateAudioStream(text, undefined, signal);
}

/** The rejection itself, so one throw can carry more than one assertion. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((reason: unknown) => reason);

/** A response body that hands out `chunks` and then stalls, never closing. */
function stallingBody(
  chunks: Uint8Array[],
  cancel: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
    },
    cancel,
  });
}

function pcmResponse(body: BodyInit | null, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RemoteTTSPlayer", () => {
  it("adopts the container the server reports", async () => {
    // The endpoint decides the format: the demo's OpenAI route answers with
    // MPEG and its Gemini one with WAV. The manager labels the playback Blob
    // from `audioMimeType`, so a hardcoded value mislabels one of them.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(new ArrayBuffer(4), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        }),
    ) as typeof fetch;

    const player = createRemoteTTSPlayer({ apiEndpoint: "/api/tts" });
    expect(player.audioMimeType).toBe("audio/wav");

    await generateAudio(player, "hello");

    expect(player.audioMimeType).toBe("audio/mpeg");
  });

  it("keeps the reported container free of its parameters", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(new ArrayBuffer(4), {
          status: 200,
          headers: { "Content-Type": "audio/wav; codecs=1" },
        }),
    ) as typeof fetch;

    const player = createRemoteTTSPlayer({ apiEndpoint: "/api/tts" });
    await generateAudio(player, "hello");

    expect(player.audioMimeType).toBe("audio/wav");
  });

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

    const player = createRemoteTTSPlayer({ apiEndpoint: "/api/tts" });
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
    const player = createRemoteTTSPlayer();

    // stop() should not throw and should complete immediately
    await expect(player.stop()).resolves.toBeUndefined();
  });

  it("throws when API fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("fail", { status: 500, statusText: "Server" }),
    ) as typeof fetch;

    const player = createRemoteTTSPlayer();
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

    const player = createRemoteTTSPlayer();
    if (!player.generateAudio) {
      throw new Error("expected RemoteTTSPlayer to implement generateAudio");
    }
    const request = player.generateAudio("hello");
    const expectation = expect(request).rejects.toThrow(
      "TTS request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("times out when the error body itself stalls", async () => {
    // The failure message is read off the body, so that read has to happen
    // while the deadline is still armed -- otherwise a route that returns
    // headers and then hangs leaves the caller waiting forever.
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                controller.error(createAbortError());
              });
            },
          }),
          { status: 500, statusText: "Internal Server Error" },
        ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer();
    const request = generateAudio(player, "hello");
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

    const player = createRemoteTTSPlayer();
    const speakPromise = player.speak("hello");

    await flushAsync();
    audioInstance.onerror?.(new Event("error"));

    await expect(speakPromise).rejects.toThrow("Audio playback failed");
    expect(revokeSpy).toHaveBeenCalled();
  });
});

describe("RemoteTTSPlayer streaming", () => {
  it("exposes generateAudioStream only when streaming is enabled", () => {
    // The manager selects the streaming path with
    // `typeof player.generateAudioStream === "function"`, so an unflagged
    // player must not carry the method at all: a third-party route that
    // returns a container today would otherwise be asked to stream.
    const buffered = createRemoteTTSPlayer({ apiEndpoint: "/api/tts" });
    expect(buffered.generateAudioStream).toBeUndefined();

    const streaming = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    expect(streaming.generateAudioStream).toBeTypeOf("function");
  });

  it("sends the buffered request body and asks for PCM", async () => {
    // A streaming route is the same route: only the Accept header tells it
    // which shape the caller can take, so the payload must not drift.
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const accept = (init?.headers as Record<string, string> | undefined)
          ?.Accept;

        return accept === "audio/pcm"
          ? pcmResponse(new Uint8Array([1, 2]), "audio/pcm")
          : new Response(new ArrayBuffer(2), {
              status: 200,
              headers: { "Content-Type": "audio/wav" },
            });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateAudio(
      createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
      "hello",
    );
    await generateAudioStream(
      createRemoteTTSPlayer({ apiEndpoint: "/api/tts", streaming: true }),
      "hello",
    );

    const [bufferedCall, streamingCall] = fetchMock.mock.calls;
    expect(streamingCall?.[0]).toBe("/api/tts");
    expect(streamingCall?.[1]?.method).toBe("POST");
    expect(streamingCall?.[1]?.body).toBe(bufferedCall?.[1]?.body);
    expect(streamingCall?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "audio/pcm",
    });
  });

  it("takes the sample rate and channel count off the content type", async () => {
    // A rate other than the default, so the parameters are read rather than
    // the defaults happening to match.
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        new Uint8Array([1, 2, 3]),
        "audio/pcm; rate=16000; channels=1",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(player, "hello");

    expect(stream.format).toEqual({
      encoding: "pcm-s16le",
      sampleRate: 16_000,
      channels: 1,
    });

    const reader = stream.body.getReader();
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2, 3]));
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("defaults a bare audio/pcm to 24000 Hz mono", async () => {
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(new Uint8Array([1]), "audio/pcm"),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(player, "hello");

    expect(stream.format).toEqual({
      encoding: "pcm-s16le",
      sampleRate: 24_000,
      channels: 1,
    });
  });

  it("rejects a route that answered a container instead of PCM", async () => {
    // A flagged player cannot fall back: the audio has already been
    // synthesized and paid for, so a container answer is a configuration
    // error, not a retry.
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/wav",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });

    const error = await rejectionOf(generateAudioStream(player, "hello"));

    expect(error).toBeInstanceOf(CharivoProviderError);
    expect((error as Error).message).toMatch(/audio\/wav/);
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
  });

  it("rejects a multi-channel stream", async () => {
    // The manager's scheduler is mono-only, so interleaved stereo would play
    // back as noise at double speed rather than fail loudly.
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm; rate=24000; channels=2",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });

    const error = await rejectionOf(generateAudioStream(player, "hello"));

    expect(error).toBeInstanceOf(CharivoProviderError);
    expect((error as Error).message).toMatch(/2 audio channels/);
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
  });

  it("rejects a route that answered no body at all", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "Content-Type": "audio/pcm" },
        }),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });

    const error = await rejectionOf(generateAudioStream(player, "hello"));

    expect(error).toBeInstanceOf(CharivoProviderError);
    expect((error as Error).message).toMatch(/no body to read/);
  });

  it("reports the route's own failure message", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "TTS failed", details: "quota exhausted" }),
          { status: 502, statusText: "Bad Gateway" },
        ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });

    await expect(generateAudioStream(player, "hello")).rejects.toThrow(
      "TTS API failed: quota exhausted",
    );
  });

  it("times out when the response headers never arrive", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const request = generateAudioStream(player, "hello");
    const expectation = expect(request).rejects.toThrow(
      "TTS request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("errors the body when the stream goes quiet", async () => {
    vi.useFakeTimers();
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(player, "hello");
    const reader = stream.body.getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });

    const stalled = reader.read();
    const expectation = expect(stalled).rejects.toThrow(CharivoTimeoutError);

    await vi.advanceTimersByTimeAsync(10_000);

    await expectation;
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
  });

  it("keeps a slow but alive stream running past the inactivity window", async () => {
    // The whole point of the split deadline: one fixed timer over the body
    // would cap how long an utterance may be, cutting a healthy long reply.
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        new ReadableStream<Uint8Array>({
          start(controller) {
            let sent = 0;
            const tick = () => {
              setTimeout(() => {
                controller.enqueue(new Uint8Array([sent]));
                sent += 1;

                if (sent < 12) {
                  tick();
                } else {
                  controller.close();
                }
              }, 5_000);
            };

            tick();
          },
        }),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(player, "hello");
    const reader = stream.body.getReader();
    const chunks: Uint8Array[] = [];
    const drained = (async () => {
      for (;;) {
        const result = await reader.read();

        if (result.done) {
          return;
        }

        chunks.push(result.value);
      }
    })();

    await vi.advanceTimersByTimeAsync(60_000);

    await drained;
    expect(chunks).toHaveLength(12);
  });

  it("aborts the request when the caller's signal fires", async () => {
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          requestSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const controller = new AbortController();
    const request = generateAudioStream(player, "hello", controller.signal);
    const expectation = expect(request).rejects.toThrow("aborted");

    await flushAsync();
    controller.abort();

    await expectation;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("settles a stream whose signal aborted before it existed", async () => {
    // The gap between fetchWithTimeout unwiring its own cancellation and this
    // player wiring its own. An abort landing there used to be dropped
    // entirely, which leaves the route synthesizing -- and billing -- with
    // nobody left to stop it.
    const cancelUpstream = vi.fn();
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async () => {
      controller.abort();

      return pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      );
    }) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(
      player,
      "hello",
      controller.signal,
    );

    await expect(stream.body.getReader().read()).rejects.toBe(
      controller.signal.reason,
    );
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
  }, 1_000);

  it("rejects a pending read when the caller aborts mid-stream", async () => {
    // The barge-in path: the scheduler is parked on a read at the moment the
    // user interrupts. The returned stream is still the consumer's, so
    // stopping the route is only half of it -- that read has to settle, or
    // stop-speaking waits forever.
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const controller = new AbortController();
    const stream = await generateAudioStream(
      player,
      "hello",
      controller.signal,
    );
    const reader = stream.body.getReader();

    await reader.read();
    const pending = reader.read();
    await flushMicrotasks();

    controller.abort();

    await expect(pending).rejects.toBe(controller.signal.reason);
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
    // A real deadline, so a regression fails here instead of hanging the suite.
  }, 1_000);

  it("settles once when an abort and a cancel arrive together", async () => {
    // What the manager's stop() does: abort the signal it passed and cancel
    // the body it was reading, in the same tick.
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const controller = new AbortController();
    const stream = await generateAudioStream(
      player,
      "hello",
      controller.signal,
    );
    const reader = stream.body.getReader();

    await reader.read();
    const pending = reader.read();
    await flushMicrotasks();

    controller.abort();
    const cancelled = reader.cancel();

    await expect(pending).rejects.toBe(controller.signal.reason);
    // Cancelling a stream the abort already errored reports that same reason
    // rather than resolving -- a caller that awaits both has to expect it.
    await expect(cancelled).rejects.toBe(controller.signal.reason);
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
  }, 1_000);

  it("cancels the upstream body when the signal fires after the headers", async () => {
    // fetchWithTimeout unwires its own controller once the response is handed
    // back, so past the headers the body is the only handle on the route.
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const controller = new AbortController();
    const stream = await generateAudioStream(
      player,
      "hello",
      controller.signal,
    );

    controller.abort();

    expect(cancelUpstream).toHaveBeenCalledTimes(1);
    // The returned stream is settled too, not just the route -- without this
    // the test passes while an abort is silently swallowed.
    await expect(stream.body.getReader().read()).rejects.toBe(
      controller.signal.reason,
    );
  }, 1_000);

  it("cancels the upstream body and disarms the timer when the body is cancelled", async () => {
    vi.useFakeTimers();
    const cancelUpstream = vi.fn();
    globalThis.fetch = vi.fn(async () =>
      pcmResponse(
        stallingBody([new Uint8Array([1])], cancelUpstream),
        "audio/pcm",
      ),
    ) as unknown as typeof fetch;

    const player = createRemoteTTSPlayer({
      apiEndpoint: "/api/tts",
      streaming: true,
    });
    const stream = await generateAudioStream(player, "hello");
    const reader = stream.body.getReader();

    await reader.read();
    const pending = reader.read();
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(1);

    // Asserted before awaiting: cancelling has to disarm the timer itself,
    // leaving no window in which a stray callback could still fire into a
    // stream that is already gone.
    const cancelled = reader.cancel();
    expect(cancelUpstream).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await cancelled;
    await expect(pending).resolves.toMatchObject({ done: true });
  });
});
