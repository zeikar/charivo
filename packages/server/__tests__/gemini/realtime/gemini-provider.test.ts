import { afterEach, describe, expect, it, vi } from "vitest";
import { CharivoStateError, GEMINI_LIVE_ADAPTER } from "@charivo/core";
import { GeminiRealtimeProvider } from "../../../src/gemini/realtime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GeminiRealtimeProvider", () => {
  it("converts normalized realtime sessions into Gemini wire format", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        // Never in the URL: proxies and request logs capture query strings.
        // Exact equality (rather than not.toContain) pins that no query
        // string -- key or otherwise -- is ever appended.
        expect(String(input)).toBe(
          "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
        );
        expect(init?.headers).toEqual({
          "x-goog-api-key": "secret-key",
          "Content-Type": "application/json",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          uses: 1,
          bidiGenerateContentSetup: {
            model: "models/gemini-3.1-flash-live-preview",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
            },
            outputAudioTranscription: {},
          },
        });

        return Response.json({ name: "auth_tokens/abc123" });
      },
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });
    const session = await provider.createSession({
      transport: "websocket",
      session: {
        provider: "gemini",
      },
    });

    expect(session).toEqual({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
      token: "auth_tokens/abc123",
    });
  });

  it("rejects unsupported models", async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "gemini", model: "gemini-1.0-pro" },
      }),
    ).rejects.toThrow('does not support model "gemini-1.0-pro"');
  });

  it("falls back to the default voice for an unknown voice", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const setup = body.bidiGenerateContentSetup as Record<string, unknown>;
        const generationConfig = setup.generationConfig as Record<
          string,
          unknown
        >;
        expect(generationConfig).toMatchObject({
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        });

        return Response.json({ name: "auth_tokens/abc123" });
      },
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });
    await provider.createSession({
      transport: "websocket",
      session: { provider: "gemini", voice: "not-a-real-voice" },
    });
  });

  it('rejects toolChoice "required"', async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "gemini", toolChoice: "required" },
      }),
    ).rejects.toThrow('does not support toolChoice "required"');
  });

  it("omits inputAudioTranscription from the mint body when disabled", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const setup = body.bidiGenerateContentSetup as Record<string, unknown>;
        expect(setup).not.toHaveProperty("inputAudioTranscription");

        return Response.json({ name: "auth_tokens/abc123" });
      },
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });
    await provider.createSession({
      transport: "websocket",
      session: {
        provider: "gemini",
        inputAudioTranscription: { enabled: false },
      },
    });
  });

  it("requests inputAudioTranscription only when enabled", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const setup = body.bidiGenerateContentSetup as Record<string, unknown>;
        expect(setup.inputAudioTranscription).toEqual({});

        return Response.json({ name: "auth_tokens/abc123" });
      },
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });
    await provider.createSession({
      transport: "websocket",
      session: {
        provider: "gemini",
        inputAudioTranscription: { enabled: true },
      },
    });
  });

  it("rejects an explicit inputAudioTranscription model", async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: {
          provider: "gemini",
          inputAudioTranscription: { model: "x" },
        },
      }),
    ).rejects.toThrow('does not support inputAudioTranscription.model "x"');
  });

  it("maps tools into functionDeclarations", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const setup = body.bidiGenerateContentSetup as Record<string, unknown>;
        expect(setup.tools).toEqual([
          {
            functionDeclarations: [
              {
                name: "setExpression",
                description: "Update expression",
                parameters: { type: "object", properties: {} },
              },
            ],
          },
        ]);

        return Response.json({ name: "auth_tokens/abc123" });
      },
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });
    await provider.createSession({
      transport: "websocket",
      session: {
        provider: "gemini",
        tools: [
          {
            type: "function",
            name: "setExpression",
            description: "Update expression",
            parameters: { type: "object", properties: {} },
          },
        ],
      },
    });
  });

  it("rejects unsupported providers", async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "openai" },
      }),
    ).rejects.toThrow('only supports provider "gemini"');
  });

  it("rejects unsupported transports", async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "webrtc",
        session: { provider: "gemini" },
      }),
    ).rejects.toThrow("only supports websocket transport");
  });

  it("rejects unsupported adapters", async () => {
    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        adapter: "unsupported-adapter",
        transport: "websocket",
        session: { provider: "gemini" },
      }),
    ).rejects.toThrow('does not support adapter "unsupported-adapter"');
  });

  it("enforces server-only usage unless dangerouslyAllowBrowser is enabled", () => {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });

    try {
      expect(
        () => new GeminiRealtimeProvider({ apiKey: "secret-key" }),
      ).toThrow(CharivoStateError);

      expect(
        () =>
          new GeminiRealtimeProvider({
            apiKey: "secret-key",
            dangerouslyAllowBrowser: true,
          }),
      ).not.toThrow();
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("throws CharivoProviderError when the mint request fails, without leaking the API key", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    let caught: unknown;
    try {
      await provider.createSession({
        transport: "websocket",
        session: { provider: "gemini" },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini Realtime Error: bad request",
    });
    expect((caught as Error).message).not.toContain("secret-key");
  });

  it("throws CharivoProviderError when the mint response body is not JSON", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("not-json", { status: 200 }),
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "gemini" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      cause: expect.any(SyntaxError),
    });
  });

  it("throws CharivoProviderError when the mint response is missing a token name", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({})) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "gemini" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini Realtime Error: invalid ephemeral token response",
    });
  });

  it("throws CharivoProviderError when the mint response has an empty token name", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ name: "" }),
    ) as typeof fetch;

    const provider = new GeminiRealtimeProvider({ apiKey: "secret-key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "gemini" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "Gemini Realtime Error: invalid ephemeral token response",
    });
  });
});
