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
});
