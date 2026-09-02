import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoStateError,
  GEMINI_LIVE_ADAPTER,
} from "@charivo/core";
import type { RealtimeSessionRequest } from "@charivo/core";
import { getGeminiLiveBootstrap } from "../../src/gemini/bootstrap";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const SOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

const request: RealtimeSessionRequest = {
  transport: "websocket",
  session: {
    provider: "gemini",
    model: "gemini-3.1-flash-live-preview",
    voice: "Puck",
    instructions: "Answer in one sentence.",
  },
};

function makeFetchOk(payload: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

function makeFetchNonOk(errorBody: string): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    text: async () => errorBody,
    json: async () => {
      throw new Error("not used");
    },
  })) as unknown as typeof fetch;
}

function mintBody(mockFetch: typeof fetch): Record<string, unknown> {
  const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
    string,
    RequestInit,
  ];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("getGeminiLiveBootstrap — apiKey (dev-bootstrap) path", () => {
  it("returns a websocket bootstrap carrying the minted token name", async () => {
    globalThis.fetch = makeFetchOk({ name: "auth_tokens/abc123" });

    const result = await getGeminiLiveBootstrap({ apiKey: "g-key" }, request);

    expect(result).toEqual({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: SOCKET_URL,
      token: "auth_tokens/abc123",
    });
  });

  it("mints against auth_tokens with the key in a header and the whole session in the token", async () => {
    const mockFetch = makeFetchOk({ name: "auth_tokens/abc123" });
    globalThis.fetch = mockFetch;

    await getGeminiLiveBootstrap({ apiKey: "g-key" }, request);

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    // Exact equality pins that the key never rides in a query string.
    expect(url).toBe(AUTH_TOKENS_URL);
    expect(init.headers).toEqual({
      "x-goog-api-key": "g-key",
      "Content-Type": "application/json",
    });
    expect(mintBody(mockFetch)).toEqual({
      uses: 1,
      bidiGenerateContentSetup: {
        model: "models/gemini-3.1-flash-live-preview",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
        },
        outputAudioTranscription: {},
        systemInstruction: { parts: [{ text: "Answer in one sentence." }] },
      },
    });
  });

  it("applies the model and voice defaults when the session omits them", async () => {
    const mockFetch = makeFetchOk({ name: "auth_tokens/abc123" });
    globalThis.fetch = mockFetch;

    await getGeminiLiveBootstrap(
      { apiKey: "g-key" },
      { transport: "websocket", session: { provider: "gemini" } },
    );

    const setup = mintBody(mockFetch).bidiGenerateContentSetup as Record<
      string,
      unknown
    >;
    expect(setup.model).toBe("models/gemini-3.1-flash-live-preview");
    expect(setup.generationConfig).toMatchObject({
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    });
  });

  it("falls back to the default voice for one Google does not offer, as the server provider does", async () => {
    const mockFetch = makeFetchOk({ name: "auth_tokens/abc123" });
    globalThis.fetch = mockFetch;

    // What RealtimeManager folds in from a character carrying an OpenAI voice.
    await getGeminiLiveBootstrap(
      { apiKey: "g-key" },
      {
        transport: "websocket",
        session: { provider: "gemini", voice: "marin" },
      },
    );

    const setup = mintBody(mockFetch).bidiGenerateContentSetup as Record<
      string,
      unknown
    >;
    expect(setup.generationConfig).toMatchObject({
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    });
  });

  it("requests input transcription only when enabled, and maps tools and maxTokens", async () => {
    const mockFetch = makeFetchOk({ name: "auth_tokens/abc123" });
    globalThis.fetch = mockFetch;

    await getGeminiLiveBootstrap(
      { apiKey: "g-key" },
      {
        ...request,
        session: {
          ...request.session,
          maxTokens: 256,
          inputAudioTranscription: { enabled: true },
          tools: [
            {
              type: "function",
              name: "setExpression",
              description: "Set the expression.",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      },
    );

    const setup = mintBody(mockFetch).bidiGenerateContentSetup as Record<
      string,
      unknown
    >;
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.generationConfig).toMatchObject({ maxOutputTokens: 256 });
    expect(setup.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "setExpression",
            description: "Set the expression.",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    ]);
  });

  it("refuses what the Live API cannot express, the way the server provider does", async () => {
    globalThis.fetch = makeFetchOk({ name: "auth_tokens/abc123" });

    await expect(
      getGeminiLiveBootstrap(
        { apiKey: "g-key" },
        { ...request, session: { ...request.session, toolChoice: "none" } },
      ),
    ).rejects.toThrow(CharivoStateError);

    await expect(
      getGeminiLiveBootstrap(
        { apiKey: "g-key" },
        {
          ...request,
          session: {
            ...request.session,
            inputAudioTranscription: { model: "whisper-1" },
          },
        },
      ),
    ).rejects.toThrow('inputAudioTranscription.model "whisper-1"');
  });

  it("throws CharivoProviderError when fetch responds non-ok", async () => {
    globalThis.fetch = makeFetchNonOk("bad key");

    await expect(
      getGeminiLiveBootstrap({ apiKey: "g-key" }, request),
    ).rejects.toThrow(CharivoProviderError);

    await expect(
      getGeminiLiveBootstrap({ apiKey: "g-key" }, request),
    ).rejects.toThrow("bad key");
  });

  it("throws CharivoProviderError when the payload has no token name", async () => {
    globalThis.fetch = makeFetchOk({});

    await expect(
      getGeminiLiveBootstrap({ apiKey: "g-key" }, request),
    ).rejects.toThrow(CharivoProviderError);
  });

  it("throws CharivoProviderError (not SyntaxError) when json() rejects", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("bad json");
      },
      text: async () => "bad json",
    })) as unknown as typeof fetch;

    await expect(
      getGeminiLiveBootstrap({ apiKey: "g-key" }, request),
    ).rejects.toThrow(CharivoProviderError);

    await expect(
      getGeminiLiveBootstrap({ apiKey: "g-key" }, request),
    ).rejects.not.toThrow(SyntaxError);
  });
});

describe("getGeminiLiveBootstrap — precedence", () => {
  it("uses sessionBootstrap when provided alongside apiKey; fetch is not called", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const sessionBootstrap = vi.fn(async () => ({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket" as const,
      url: SOCKET_URL,
      token: "from-bootstrap",
    }));

    const result = await getGeminiLiveBootstrap(
      { sessionBootstrap, apiKey: "g-key" },
      request,
    );

    expect(result).toHaveProperty("token", "from-bootstrap");
    expect(sessionBootstrap).toHaveBeenCalledWith(request);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the apiEndpoint route when provided alongside apiKey; auth_tokens is not called", async () => {
    const validBootstrap = {
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: SOCKET_URL,
      token: "from-endpoint",
    };
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => validBootstrap,
      text: async () => JSON.stringify(validBootstrap),
    })) as unknown as typeof fetch;
    globalThis.fetch = mockFetch;

    const result = await getGeminiLiveBootstrap(
      { apiEndpoint: "https://my-server.example/session", apiKey: "g-key" },
      request,
    );

    expect(result).toHaveProperty("token", "from-endpoint");

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://my-server.example/session");
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it("throws CharivoStateError naming all three options when none are provided", async () => {
    await expect(getGeminiLiveBootstrap({}, request)).rejects.toThrow(
      CharivoStateError,
    );

    await expect(getGeminiLiveBootstrap({}, request)).rejects.toThrow(
      /sessionBootstrap/,
    );

    await expect(getGeminiLiveBootstrap({}, request)).rejects.toThrow(
      /apiEndpoint/,
    );

    await expect(getGeminiLiveBootstrap({}, request)).rejects.toThrow(/apiKey/);
  });
});
