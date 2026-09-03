import { afterEach, describe, expect, it, vi } from "vitest";
import { CharivoStateError, type CharivoProviderError } from "@charivo/core";
import { GeminiSTTProvider } from "../../src/gemini/provider";

const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
/** Literal so the expectation never re-implements the provider's encoder. */
const AUDIO_BASE64 = "AQIDBAUGBwg=";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Test-side decoder only; the provider encodes with `btoa`. */
function fromBase64(data: string): Buffer {
  return Buffer.from(data, "base64");
}

function transcriptResponse(text = "hello there"): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ audioTranscription: { text } }] } }],
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

function sentBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function sentInlineData(init?: RequestInit): {
  mimeType: string;
  data: string;
} {
  const body = sentBody(init) as {
    contents: [{ parts: [{ inlineData: { mimeType: string; data: string } }] }];
  };

  return body.contents[0].parts[0].inlineData;
}

describe("GeminiSTTProvider", () => {
  it("posts the audio inline and returns the transcript", async () => {
    const fetchMock = stubFetch(async (input, init) => {
      // Never in the URL: proxies and request logs capture query strings.
      // Exact equality pins that no query string is ever appended.
      expect(String(input)).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent",
      );
      expect(init?.headers).toEqual({
        "x-goog-api-key": "secret-key",
        "Content-Type": "application/json",
      });
      // toEqual on the whole body: it proves there is no prompt part and no
      // generationConfig when no language was asked for.
      expect(sentBody(init)).toEqual({
        contents: [
          {
            parts: [
              {
                inlineData: { mimeType: "audio/webm", data: AUDIO_BASE64 },
              },
            ],
          },
        ],
      });

      return transcriptResponse();
    });

    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).resolves.toBe("hello there");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to audio/wav for a Blob without a type", async () => {
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await provider.transcribe(new Blob([AUDIO]));

    expect(sentInlineData(fetchMock.mock.calls[0]?.[1])).toEqual({
      mimeType: "audio/wav",
      data: AUDIO_BASE64,
    });
  });

  it("falls back to audio/wav for a raw ArrayBuffer", async () => {
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await provider.transcribe(AUDIO.buffer);

    expect(sentInlineData(fetchMock.mock.calls[0]?.[1])).toEqual({
      mimeType: "audio/wav",
      data: AUDIO_BASE64,
    });
  });

  it("encodes a payload larger than one chunk without corrupting it", async () => {
    const large = new Uint8Array(70_000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await provider.transcribe(new Blob([large], { type: "audio/webm" }));

    const decoded = fromBase64(
      sentInlineData(fetchMock.mock.calls[0]?.[1]).data,
    );
    expect(decoded.equals(Buffer.from(large))).toBe(true);
  });

  it("sends the configured default language as a hint", async () => {
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({
      apiKey: "secret-key",
      defaultLanguage: "en",
    });

    await provider.transcribe(new Blob([AUDIO], { type: "audio/webm" }));

    expect(sentBody(fetchMock.mock.calls[0]?.[1]).generationConfig).toEqual({
      audioTranscriptionConfig: { languageCodes: ["en"] },
    });
  });

  it("prefers options.language over the configured default", async () => {
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({
      apiKey: "secret-key",
      defaultLanguage: "en",
    });

    await provider.transcribe(new Blob([AUDIO], { type: "audio/webm" }), {
      language: "ko",
    });

    expect(sentBody(fetchMock.mock.calls[0]?.[1]).generationConfig).toEqual({
      audioTranscriptionConfig: { languageCodes: ["ko"] },
    });
  });

  it("builds the endpoint from baseUrl and defaultModel", async () => {
    const fetchMock = stubFetch(async () => transcriptResponse());
    const provider = new GeminiSTTProvider({
      apiKey: "secret-key",
      baseUrl: "https://proxy.example/",
      defaultModel: "custom-transcribe",
    });

    await provider.transcribe(new Blob([AUDIO], { type: "audio/webm" }));

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://proxy.example/v1beta/models/custom-transcribe:generateContent",
    );
  });

  it("takes the transcription part when the answer starts with a text part", async () => {
    stubFetch(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "sure" },
                { audioTranscription: { text: "hello there" } },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).resolves.toBe("hello there");
  });

  it("resolves an empty string for the silent answer", async () => {
    stubFetch(async () => Response.json({ candidates: [{ content: {} }] }));
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).resolves.toBe("");
  });

  it("rejects an answer without candidates", async () => {
    stubFetch(async () =>
      Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
    );
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects a transcription part whose text is missing", async () => {
    stubFetch(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ audioTranscription: {} }] } }],
      }),
    );
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects parts that carry no transcription", async () => {
    stubFetch(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: "cannot" }] } }],
      }),
    );
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
    });
  });

  it("rejects a failed request without leaking the API key", async () => {
    stubFetch(async () => new Response("bad request", { status: 400 }));
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    let caught: unknown;
    try {
      await provider.transcribe(new Blob([AUDIO], { type: "audio/webm" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini STT Error: bad request",
    });
    expect((caught as Error).message).not.toContain("secret-key");
  });

  it("carries the rate limit body into the error message", async () => {
    stubFetch(
      async () =>
        new Response("free tier limit: 3, retry in 20s", { status: 429 }),
    );
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini STT Error: free tier limit: 3, retry in 20s",
    });
  });

  it("rejects a response body that is not JSON", async () => {
    stubFetch(async () => new Response("not-json", { status: 200 }));
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      cause: expect.any(SyntaxError),
    });
  });

  it("wraps a network failure as a provider error", async () => {
    const error = new TypeError("fetch failed");
    const fetchMock = stubFetch(async () => transcriptResponse());
    fetchMock.mockRejectedValueOnce(error);
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    await expect(
      provider.transcribe(new Blob([AUDIO], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "fetch failed",
      cause: error,
    } satisfies Partial<CharivoProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out on the default 30s budget", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const provider = new GeminiSTTProvider({ apiKey: "secret-key" });

    const request = provider.transcribe(
      new Blob([AUDIO], { type: "audio/webm" }),
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini STT request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await expectation;
  });

  it("times out on a configured budget", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const provider = new GeminiSTTProvider({
      apiKey: "secret-key",
      timeoutMs: 1_000,
    });

    const request = provider.transcribe(
      new Blob([AUDIO], { type: "audio/webm" }),
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini STT request timed out after 1000ms",
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
    const provider = new GeminiSTTProvider({
      apiKey: "secret-key",
      timeoutMs: 5_000,
    });

    const request = provider.transcribe(
      new Blob([AUDIO], { type: "audio/webm" }),
    );
    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "Gemini STT request timed out after 5000ms",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces server-only usage unless dangerouslyAllowBrowser is enabled", () => {
    vi.stubGlobal("window", {});

    expect(() => new GeminiSTTProvider({ apiKey: "secret-key" })).toThrow(
      CharivoStateError,
    );
    expect(() => new GeminiSTTProvider({ apiKey: "secret-key" })).toThrow(
      "Gemini STT provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
    );
    expect(
      () =>
        new GeminiSTTProvider({
          apiKey: "secret-key",
          dangerouslyAllowBrowser: true,
        }),
    ).not.toThrow();
  });
});
