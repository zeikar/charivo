import { afterEach, describe, expect, it, vi } from "vitest";
import { CharivoStateError, type CharivoProviderError } from "@charivo/core";
import { GeminiTTSProvider } from "../../src/gemini/provider";

const PCM_MIME = "audio/l16; rate=24000; channels=1";
const PCM = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Test-side encoder only; the provider decodes with `atob`. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function audioResponse(bytes = PCM, mimeType = PCM_MIME): Response {
  return Response.json({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType, data: toBase64(bytes) } }],
        },
      },
    ],
  });
}

function textResponse(text = "sorry"): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text }] } }],
  });
}

function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Hangs until the request is aborted, the way a stalled endpoint behaves. */
function stubHangingFetch() {
  return stubFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  );
}

/** One SSE frame carrying audio, in the shape the streaming endpoint sends. */
function audioEvent(bytes = PCM, mimeType = PCM_MIME): string {
  return `data: ${JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType, data: toBase64(bytes) } }],
        },
      },
    ],
  })}\n\n`;
}

/** A healthy stream ends with a text part carrying the finish reason. */
function terminalEvent(finishReason = "STOP"): string {
  return `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text: "" }] }, finishReason }],
  })}\n\n`;
}

/**
 * A 200 whose SSE body the test pushes frames into. Like stubHangingFetch it
 * models a real aborted request: the body errors once the request's signal
 * aborts, so a test can prove the upstream request was really cancelled.
 */
function controllableSseResponse(init?: RequestInit) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let observedAbort = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });

  init?.signal?.addEventListener("abort", () => {
    observedAbort = true;
    controller.error(new DOMException("aborted", "AbortError"));
  });

  return {
    response: new Response(body, { status: 200 }),
    signal: init?.signal,
    /** True once the fake upstream body has seen the request aborted. */
    get aborted() {
      return observedAbort;
    },
    push: (frame: string) => controller.enqueue(encoder.encode(frame)),
    /** EOF, with whatever was pushed and nothing more. */
    close: () => controller.close(),
  };
}

/** Answers every fetch with a fresh controllable SSE body, in call order. */
function stubSseFetch() {
  const streams: ReturnType<typeof controllableSseResponse>[] = [];
  const fetchMock = stubFetch(async (_input, init) => {
    const sse = controllableSseResponse(init);
    streams.push(sse);

    return sse.response;
  });

  return { fetchMock, streams };
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      return chunks;
    }

    chunks.push(value);
  }
}

/** Lets the provider's pump drain what the test just pushed. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function readWavHeader(wav: ArrayBuffer) {
  const view = new DataView(wav);
  const decoder = new TextDecoder();
  const ascii = (offset: number) =>
    decoder.decode(new Uint8Array(wav, offset, 4));

  return {
    riff: ascii(0),
    riffSize: view.getUint32(4, true),
    wave: ascii(8),
    fmt: ascii(12),
    fmtChunkSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(36),
    dataSize: view.getUint32(40, true),
  };
}

describe("GeminiTTSProvider", () => {
  it("posts the preamble and voice config, and never rate or pitch", async () => {
    const fetchMock = stubFetch(async (input, init) => {
      // Never in the URL: proxies and request logs capture query strings.
      // Exact equality pins that no query string is ever appended.
      expect(String(input)).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent",
      );
      expect(init?.headers).toEqual({
        "x-goog-api-key": "secret-key",
        "Content-Type": "application/json",
      });
      // toEqual on the whole body: it pins the exact preamble and proves
      // rate/pitch never reach the wire.
      expect(JSON.parse(String(init?.body))).toEqual({
        contents: [{ parts: [{ text: "TTS the following text:\nhello" }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      });

      return audioResponse();
    });

    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });
    await provider.generateSpeech("hello", { rate: 1.5, pitch: 1.2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds the endpoint from baseUrl and defaultModel", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      baseUrl: "https://proxy.example/",
      defaultModel: "custom-tts",
    });

    await provider.generateSpeech("hello");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://proxy.example/v1beta/models/custom-tts:generateContent",
    );
  });

  it("changes the endpoint model via setModel", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    provider.setModel("other-tts");
    await provider.generateSpeech("hello");

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/other-tts:generateContent",
    );
  });

  it("prefers options.voice over setVoice over defaultVoice", async () => {
    const voices: string[] = [];
    stubFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        generationConfig: {
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
          };
        };
      };
      voices.push(
        body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
          .voiceName,
      );

      return audioResponse();
    });

    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      defaultVoice: "Puck",
    });

    await provider.generateSpeech("hello");
    provider.setVoice("Leda");
    await provider.generateSpeech("hello");
    await provider.generateSpeech("hello", { voice: "Zephyr" });

    expect(voices).toEqual(["Puck", "Leda", "Zephyr"]);
  });

  it("wraps the returned PCM in a 44-byte WAV header", async () => {
    stubFetch(async () => audioResponse());
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const wav = await provider.generateSpeech("hello");

    expect(wav.byteLength).toBe(52);
    expect(readWavHeader(wav)).toEqual({
      riff: "RIFF",
      riffSize: 44,
      wave: "WAVE",
      fmt: "fmt ",
      fmtChunkSize: 16,
      audioFormat: 1,
      channels: 1,
      sampleRate: 24000,
      byteRate: 48000,
      blockAlign: 2,
      bitsPerSample: 16,
      data: "data",
      dataSize: 8,
    });
    expect(new Uint8Array(wav, 44)).toEqual(PCM);
  });

  it("takes the audio part when the answer starts with a text part", async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "sure" },
                {
                  inlineData: { mimeType: PCM_MIME, data: toBase64(PCM) },
                },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const wav = await provider.generateSpeech("hello");

    expect(wav.byteLength).toBe(52);
    expect(new Uint8Array(wav, 44)).toEqual(PCM);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("carries the MIME sample rate into the header", async () => {
    stubFetch(async () =>
      audioResponse(PCM, "audio/l16; rate=16000; channels=1"),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const header = readWavHeader(await provider.generateSpeech("hello"));

    expect(header.sampleRate).toBe(16000);
    expect(header.byteRate).toBe(32000);
  });

  it("carries the MIME channel count into the header", async () => {
    stubFetch(async () =>
      audioResponse(PCM, "audio/l16; rate=24000; channels=2"),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const header = readWavHeader(await provider.generateSpeech("hello"));

    expect(header.channels).toBe(2);
    expect(header.blockAlign).toBe(4);
    expect(header.byteRate).toBe(96000);
  });

  it("defaults to 24000 Hz mono when the MIME type has no parameters", async () => {
    stubFetch(async () => audioResponse(PCM, "audio/l16"));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const header = readWavHeader(await provider.generateSpeech("hello"));

    expect(header.sampleRate).toBe(24000);
    expect(header.channels).toBe(1);
  });

  it("parses an uppercase subtype written without spaces", async () => {
    stubFetch(async () =>
      audioResponse(PCM, "audio/L16;rate=24000;channels=1"),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const header = readWavHeader(await provider.generateSpeech("hello"));

    expect(header.sampleRate).toBe(24000);
    expect(header.channels).toBe(1);
  });

  it("parses a mixed-case media type and parameter name", async () => {
    stubFetch(async () => audioResponse(PCM, "Audio/L16; Rate=16000"));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const header = readWavHeader(await provider.generateSpeech("hello"));

    expect(header.sampleRate).toBe(16000);
  });

  it("rejects an audio format that is not L16 PCM", async () => {
    stubFetch(async () => audioResponse(PCM, "audio/mpeg"));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects a response whose parts carry no inlineData", async () => {
    stubFetch(async () => textResponse("x"));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects a response without candidates", async () => {
    stubFetch(async () => Response.json({ candidates: [] }));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects a failed request without leaking the API key", async () => {
    stubFetch(async () => new Response("bad request", { status: 400 }));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    let caught: unknown;
    try {
      await provider.generateSpeech("hello");
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini TTS Error: bad request",
    });
    expect((caught as Error).message).not.toContain("secret-key");
  });

  it("rejects a response body that is not JSON", async () => {
    stubFetch(async () => new Response("not-json", { status: 200 }));
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      cause: expect.any(SyntaxError),
    });
  });

  it("wraps a network failure as a provider error and does not retry it", async () => {
    const error = new TypeError("fetch failed");
    const fetchMock = stubFetch(async () => audioResponse());
    fetchMock.mockRejectedValueOnce(error);
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "fetch failed",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 5xx", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    fetchMock.mockResolvedValueOnce(
      new Response("overloaded", { status: 500 }),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const wav = await provider.generateSpeech("hello");

    expect(wav.byteLength).toBe(52);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once when the model answers with text instead of audio", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    fetchMock.mockResolvedValueOnce(textResponse());
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const wav = await provider.generateSpeech("hello");

    expect(wav.byteLength).toBe(52);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 5xx", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    fetchMock.mockResolvedValueOnce(
      new Response("overloaded", { status: 500 }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response("still down", { status: 500 }),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini TTS Error: still down",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second answer without audio", async () => {
    const fetchMock = stubFetch(async () => textResponse());
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = stubFetch(async () => audioResponse());
    fetchMock.mockResolvedValueOnce(
      new Response("bad request", { status: 400 }),
    );
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    await expect(provider.generateSpeech("hello")).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini TTS Error: bad request",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives the retry only the time left on the original deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = stubHangingFetch();
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(
            () => resolve(new Response("overloaded", { status: 500 })),
            4_000,
          );
        }),
    );
    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      timeoutMs: 10_000,
    });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini TTS request timed out after 10000ms",
    });

    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 10s total, not 14: the retry inherited the remaining 6s, not a fresh budget.
    await vi.advanceTimersByTimeAsync(6_000);
    await expectation;
  });

  it("keeps the first failure as the cause when the deadline leaves no retry", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(
            () => resolve(new Response("overloaded", { status: 500 })),
            4_000,
          );
        }),
    );
    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      timeoutMs: 4_000,
    });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini TTS request timed out after 4000ms",
      cause: expect.objectContaining({
        name: "CharivoProviderError",
        message: "Gemini TTS Error: overloaded",
      }),
    });

    await vi.advanceTimersByTimeAsync(4_000);
    await expectation;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out on the default 90s budget", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini TTS request timed out after 90000ms",
    });

    await vi.advanceTimersByTimeAsync(90_000);
    await expectation;
  });

  it("times out on a configured budget", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      timeoutMs: 1_000,
    });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini TTS request timed out after 1000ms",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });

  it("classifies a timeout during body download as CharivoTimeoutError, not a provider error", async () => {
    vi.useFakeTimers();
    // Headers arrive immediately (a real fetch() would already have resolved),
    // but reading the body never settles on its own — only the timeout's
    // abort, observed by consumeBody's signal, ever rejects it.
    const fetchMock = stubFetch((_input, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      } as unknown as Response),
    );
    const provider = new GeminiTTSProvider({
      apiKey: "secret-key",
      timeoutMs: 5_000,
    });

    const request = provider.generateSpeech("hello");
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini TTS request timed out after 5000ms",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
    // A body-phase timeout spends the deadline outright rather than retrying.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces server-only usage unless dangerouslyAllowBrowser is enabled", () => {
    vi.stubGlobal("window", {});

    expect(() => new GeminiTTSProvider({ apiKey: "secret-key" })).toThrow(
      CharivoStateError,
    );
    expect(() => new GeminiTTSProvider({ apiKey: "secret-key" })).toThrow(
      "Gemini TTS provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
    );
    expect(
      () =>
        new GeminiTTSProvider({
          apiKey: "secret-key",
          dangerouslyAllowBrowser: true,
        }),
    ).not.toThrow();
  });
  describe("generateSpeechStream", () => {
    it("posts the streaming endpoint with the same headers and body", async () => {
      const { fetchMock, streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello", {
        rate: 1.5,
        pitch: 1.2,
      });
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;

      const [input, init] = fetchMock.mock.calls[0];
      // Never in the URL: proxies and request logs capture query strings.
      // Exact equality pins that `alt=sse` is the only query parameter.
      expect(String(input)).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse",
      );
      expect(init?.headers).toEqual({
        "x-goog-api-key": "secret-key",
        "Content-Type": "application/json",
      });
      // The same body the buffered path sends, rate and pitch included in the
      // call and absent from the wire.
      expect(JSON.parse(String(init?.body))).toEqual({
        contents: [{ parts: [{ text: "TTS the following text:\nhello" }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      });

      await stream.body.cancel();
    });

    it("builds the streaming endpoint from baseUrl and setModel", async () => {
      const { fetchMock, streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({
        apiKey: "secret-key",
        baseUrl: "https://proxy.example/",
        defaultModel: "custom-tts",
      });

      const first = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      await (await first).body.cancel();

      provider.setModel("other-tts");
      const second = provider.generateSpeechStream("hello");
      await flush();
      streams[1].push(audioEvent());
      await (await second).body.cancel();

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "https://proxy.example/v1beta/models/custom-tts:streamGenerateContent?alt=sse",
        "https://proxy.example/v1beta/models/other-tts:streamGenerateContent?alt=sse",
      ]);
    });

    it("yields each event's audio in order and closes on STOP", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent(new Uint8Array([1, 2])));
      const stream = await pending;
      streams[0].push(audioEvent(new Uint8Array([3, 4])));
      streams[0].push(terminalEvent());

      expect(await readAll(stream.body)).toEqual([
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
      ]);
      expect(stream.format).toEqual({
        encoding: "pcm-s16le",
        sampleRate: 24000,
        channels: 1,
      });
    });

    it("takes the format from the first event's MIME type", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent(PCM, "audio/l16; rate=16000; channels=1"));
      const stream = await pending;

      expect(stream.format).toEqual({
        encoding: "pcm-s16le",
        sampleRate: 16000,
        channels: 1,
      });

      await stream.body.cancel();
    });

    it("reassembles an event split across two body chunks", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });
      const event = audioEvent();

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(event.slice(0, 20));
      await flush();
      streams[0].push(event.slice(20));
      const stream = await pending;
      streams[0].push(terminalEvent());

      expect(await readAll(stream.body)).toEqual([PCM]);
    });

    it("parses frames separated by CRLF", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent().replace(/\n/g, "\r\n"));
      const stream = await pending;
      streams[0].push(terminalEvent().replace(/\n/g, "\r\n"));

      expect(await readAll(stream.body)).toEqual([PCM]);
    });

    it("settles on the first audio event, before the stream terminates", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      let settled = false;
      const pending = provider.generateSpeechStream("hello").then((stream) => {
        settled = true;

        return stream;
      });

      await flush();
      expect(settled).toBe(false);

      streams[0].push(audioEvent());
      await flush();
      // Resolved on the first chunk, with the terminal event still to come.
      expect(settled).toBe(true);

      streams[0].push(terminalEvent());
      await (await pending).body.cancel();
    });

    it("errors the body when the stream ends with a reason other than STOP", async () => {
      const { fetchMock, streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      const expectation = expect(readAll(stream.body)).rejects.toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        message: expect.stringContaining("SAFETY"),
      });

      streams[0].push(terminalEvent("SAFETY"));
      await expectation;

      // Audio was already handed out, so this is a failed stream, not a retry.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(streams[0].signal?.aborted).toBe(true);
    });

    it("errors the body when the stream ends without a terminal event", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      const expectation = expect(readAll(stream.body)).rejects.toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        message: "Gemini TTS Error: stream ended without a finish reason",
      });

      streams[0].close();
      await expectation;
    });

    it("errors the body when a later event changes the audio format", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      const expectation = expect(readAll(stream.body)).rejects.toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        message:
          'Gemini TTS Error: audio format changed to "audio/l16; rate=16000; channels=1" mid-stream',
      });

      streams[0].push(audioEvent(PCM, "audio/l16; rate=16000; channels=1"));
      await expectation;
    });

    it("wraps a mid-stream failure that is not already a Charivo error", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      const expectation = expect(readAll(stream.body)).rejects.toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        cause: expect.any(SyntaxError),
      });

      streams[0].push("data: {not json}\n\n");
      await expectation;

      // The failed attempt stops the upstream request too, or Gemini keeps
      // synthesizing an utterance nobody can receive.
      expect(streams[0].signal?.aborted).toBe(true);
    });

    it("rejects a failed streaming request without leaking the API key", async () => {
      const fetchMock = stubFetch(
        async () => new Response("bad request", { status: 400 }),
      );
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      let caught: unknown;
      try {
        await provider.generateSpeechStream("hello");
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        message: "Gemini TTS Error: bad request",
      });
      expect((caught as Error).message).not.toContain("secret-key");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries once after a 5xx and returns the second stream", async () => {
      const { fetchMock, streams } = stubSseFetch();
      fetchMock.mockResolvedValueOnce(
        new Response("overloaded", { status: 500 }),
      );
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      streams[0].push(terminalEvent());

      expect(await readAll(stream.body)).toEqual([PCM]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries once when the response carries no body", async () => {
      const { fetchMock, streams } = stubSseFetch();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      streams[0].push(terminalEvent());

      expect(await readAll(stream.body)).toEqual([PCM]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries once when the stream terminates without any audio", async () => {
      const { fetchMock, streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(terminalEvent());
      await flush();
      streams[1].push(audioEvent());
      const stream = await pending;
      streams[1].push(terminalEvent());

      expect(await readAll(stream.body)).toEqual([PCM]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up after a second stream without any audio", async () => {
      const { fetchMock, streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      const expectation = expect(pending).rejects.toMatchObject({
        name: "CharivoProviderError",
        code: "CHARIVO_PROVIDER_ERROR",
        message: "Gemini TTS Error: response contained no audio",
      });

      await flush();
      streams[0].push(terminalEvent());
      await flush();
      streams[1].push(terminalEvent());
      await expectation;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives the streaming retry only the time left on the original deadline", async () => {
      vi.useFakeTimers();
      const { fetchMock } = stubSseFetch();
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new Response("overloaded", { status: 500 })),
              4_000,
            );
          }),
      );
      const provider = new GeminiTTSProvider({
        apiKey: "secret-key",
        timeoutMs: 10_000,
      });

      const pending = provider.generateSpeechStream("hello");
      const expectation = expect(pending).rejects.toMatchObject({
        name: "CharivoTimeoutError",
        code: "CHARIVO_TIMEOUT_ERROR",
        message: "Gemini TTS request timed out after 10000ms",
      });

      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // 10s total, not 14: the retry inherited the remaining 6s, not a fresh
      // budget. The second stream never sends a frame.
      await vi.advanceTimersByTimeAsync(6_000);
      await expectation;
    });

    it("keeps the first streaming failure as the cause when the deadline leaves no retry", async () => {
      vi.useFakeTimers();
      const { fetchMock } = stubSseFetch();
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(new Response("overloaded", { status: 500 })),
              4_000,
            );
          }),
      );
      const provider = new GeminiTTSProvider({
        apiKey: "secret-key",
        timeoutMs: 4_000,
      });

      const pending = provider.generateSpeechStream("hello");
      const expectation = expect(pending).rejects.toMatchObject({
        name: "CharivoTimeoutError",
        code: "CHARIVO_TIMEOUT_ERROR",
        message: "Gemini TTS request timed out after 4000ms",
        cause: expect.objectContaining({
          name: "CharivoProviderError",
          message: "Gemini TTS Error: overloaded",
        }),
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await expectation;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("errors the body when the stream stalls past the deadline", async () => {
      vi.useFakeTimers();
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({
        apiKey: "secret-key",
        timeoutMs: 5_000,
      });

      const pending = provider.generateSpeechStream("hello");
      await vi.advanceTimersByTimeAsync(0);
      streams[0].push(audioEvent());
      await vi.advanceTimersByTimeAsync(0);
      const stream = await pending;
      const expectation = expect(readAll(stream.body)).rejects.toMatchObject({
        name: "CharivoTimeoutError",
        code: "CHARIVO_TIMEOUT_ERROR",
        message: "Gemini TTS request timed out after 5000ms",
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await expectation;

      expect(streams[0].signal?.aborted).toBe(true);
    });

    it("aborts the upstream request when the returned body is cancelled", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });

      const pending = provider.generateSpeechStream("hello");
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;

      await stream.body.cancel();
      await flush();

      expect(streams[0].signal?.aborted).toBe(true);
      expect(streams[0].aborted).toBe(true);
    });

    it("re-throws the caller's abort from before the first chunk", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });
      const caller = new AbortController();

      const pending = provider.generateSpeechStream(
        "hello",
        undefined,
        caller.signal,
      );
      const failure = pending.then(
        () => null,
        (error: unknown) => error,
      );
      await flush();

      caller.abort();
      const caught = await failure;

      // Unclassified in both windows: a stop() reads the same whether or not
      // the first chunk had landed.
      expect((caught as Error | null)?.name).toBe("AbortError");
      expect(streams[0].signal?.aborted).toBe(true);
    });

    it("aborts the upstream request when the caller's signal aborts", async () => {
      const { streams } = stubSseFetch();
      const provider = new GeminiTTSProvider({ apiKey: "secret-key" });
      const caller = new AbortController();

      const pending = provider.generateSpeechStream(
        "hello",
        undefined,
        caller.signal,
      );
      await flush();
      streams[0].push(audioEvent());
      const stream = await pending;
      const failure = readAll(stream.body).then(
        () => null,
        (error: unknown) => error,
      );

      caller.abort();
      const caught = await failure;

      expect((caught as Error | null)?.name).toBe("AbortError");
      expect(streams[0].signal?.aborted).toBe(true);
      expect(streams[0].aborted).toBe(true);
    });
  });
});
