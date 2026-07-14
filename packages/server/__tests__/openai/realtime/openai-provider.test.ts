import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CharivoStateError,
  OPENAI_REALTIME_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";
import { OpenAIRealtimeProvider } from "../../../src/openai/realtime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("OpenAIRealtimeProvider", () => {
  it("converts normalized realtime sessions into OpenAI wire format", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;

        expect(formData.get("sdp")).toBe("offer-sdp");
        expect(JSON.parse(String(formData.get("session")))).toEqual({
          type: "realtime",
          model: "gpt-realtime-mini",
          audio: {
            output: {
              voice: "marin",
            },
          },
          instructions: "Stay in character",
          tool_choice: "auto",
          tools: [
            {
              type: "function",
              name: "setExpression",
              description: "Update expression",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          ],
        });

        return new Response("answer-sdp");
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    const session = await provider.createSession({
      transport: "webrtc",
      sdpOffer: "offer-sdp",
      session: {
        provider: "openai",
        model: "gpt-realtime-mini",
        voice: "marin",
        instructions: "Stay in character",
        toolChoice: "auto",
        tools: [
          {
            type: "function",
            name: "setExpression",
            description: "Update expression",
            parameters: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    });

    expect(session).toEqual({
      adapter: OPENAI_REALTIME_ADAPTER,
      transport: "webrtc",
      answerSdp: "answer-sdp",
    });
  });

  it("forwards inputAudioTranscription into audio.input.transcription on the WebRTC adapter", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;
        const session = JSON.parse(String(formData.get("session"))) as Record<
          string,
          unknown
        >;
        const audio = session.audio as Record<string, unknown>;
        expect(audio.input).toEqual({
          transcription: { model: "gpt-4o-mini-transcribe" },
        });

        return new Response("answer-sdp");
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    await provider.createSession({
      transport: "webrtc",
      sdpOffer: "offer-sdp",
      session: {
        provider: "openai",
        inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      },
    });
  });

  it("emits audio.input.transcription: null on the WebRTC adapter when transcription is disabled", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;
        const session = JSON.parse(String(formData.get("session"))) as Record<
          string,
          unknown
        >;
        const audio = session.audio as Record<string, unknown>;
        expect(audio.input).toEqual({ transcription: null });

        return new Response("answer-sdp");
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    await provider.createSession({
      transport: "webrtc",
      sdpOffer: "offer-sdp",
      session: {
        provider: "openai",
        inputAudioTranscription: { enabled: false },
      },
    });
  });

  it("creates ephemeral client secret bootstraps for the agents adapter", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(_input).toBe(
          "https://api.openai.com/v1/realtime/client_secrets",
        );
        expect(init?.headers).toEqual({
          Authorization: "Bearer key",
          "Content-Type": "application/json",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          session: {
            type: "realtime",
            model: "gpt-realtime-mini",
            audio: {
              output: {
                voice: "marin",
              },
            },
            instructions: "Stay in character",
            tool_choice: "auto",
          },
        });

        return Response.json({
          client_secret: {
            value: "client-secret",
          },
        });
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    const session = await provider.createSession({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      session: {
        provider: "openai",
        model: "gpt-realtime-mini",
        voice: "marin",
        instructions: "Stay in character",
        toolChoice: "auto",
      },
    });

    expect(session).toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
  });

  it("forwards inputAudioTranscription into session.audio.input.transcription on the agents adapter", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const session = body.session as Record<string, unknown>;
        const audio = session.audio as Record<string, unknown>;
        expect(audio.input).toEqual({
          transcription: { model: "gpt-4o-mini-transcribe" },
        });

        return Response.json({
          client_secret: { value: "client-secret" },
        });
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    await provider.createSession({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      session: {
        provider: "openai",
        inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      },
    });
  });

  it("emits session.audio.input.transcription: null on the agents adapter when transcription is disabled", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const session = body.session as Record<string, unknown>;
        const audio = session.audio as Record<string, unknown>;
        expect(audio.input).toEqual({ transcription: null });

        return Response.json({
          client_secret: { value: "client-secret" },
        });
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    await provider.createSession({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      session: {
        provider: "openai",
        inputAudioTranscription: { enabled: false },
      },
    });
  });

  it("rejects unsupported providers", async () => {
    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        transport: "webrtc",
        sdpOffer: "offer-sdp",
        session: {
          provider: "google",
        },
      }),
    ).rejects.toThrow('only supports provider "openai"');
  });

  it("rejects unsupported transports", async () => {
    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: {
          provider: "openai",
        },
      }),
    ).rejects.toThrow("only supports webrtc transport");
  });

  it("falls back to the legacy bootstrap and applies default model/voice when omitted", async () => {
    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;

        expect(JSON.parse(String(formData.get("session")))).toEqual({
          type: "realtime",
          model: "gpt-realtime-mini",
          audio: {
            output: {
              voice: "marin",
            },
          },
          tool_choice: "auto",
        });

        return new Response("answer-sdp");
      },
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    const session = await provider.createSession({
      transport: "webrtc",
      sdpOffer: "offer-sdp",
      session: {
        provider: "openai",
      },
    });

    expect(session).toEqual({
      adapter: OPENAI_REALTIME_ADAPTER,
      transport: "webrtc",
      answerSdp: "answer-sdp",
    });
  });

  it("rejects unsupported adapters", async () => {
    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        adapter: "unsupported-adapter",
        transport: "webrtc",
        session: {
          provider: "openai",
        },
      }),
    ).rejects.toThrow('does not support adapter "unsupported-adapter"');
  });

  it("enforces server-only usage unless dangerouslyAllowBrowser is enabled", () => {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });

    try {
      expect(() => new OpenAIRealtimeProvider({ apiKey: "key" })).toThrow(
        CharivoStateError,
      );

      expect(
        () =>
          new OpenAIRealtimeProvider({
            apiKey: "key",
            dangerouslyAllowBrowser: true,
          }),
      ).not.toThrow();
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("throws CharivoStateError for validation failures", async () => {
    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        transport: "webrtc",
        sdpOffer: "offer-sdp",
        session: { provider: "google" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoStateError",
      code: "CHARIVO_STATE_ERROR",
      message: expect.stringContaining('only supports provider "openai"'),
    });

    await expect(
      provider.createSession({
        transport: "websocket",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoStateError",
      code: "CHARIVO_STATE_ERROR",
      message: expect.stringContaining("only supports webrtc transport"),
    });

    await expect(
      provider.createSession({
        adapter: "unsupported-adapter",
        transport: "webrtc",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoStateError",
      code: "CHARIVO_STATE_ERROR",
      message: expect.stringContaining(
        'does not support adapter "unsupported-adapter"',
      ),
    });

    await expect(
      provider.createSession({
        transport: "webrtc",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoStateError",
      code: "CHARIVO_STATE_ERROR",
      message: "SDP offer is required for WebRTC realtime sessions",
    });
  });

  it("throws CharivoProviderError when the WebRTC session request fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("bad request", { status: 400 }),
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        transport: "webrtc",
        sdpOffer: "offer-sdp",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI Realtime Error: bad request",
    });
  });

  it("throws CharivoProviderError when the client secret request fails", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("server error", { status: 500 }),
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI Realtime Error: server error",
    });
  });

  it("throws CharivoProviderError when the client secret response is invalid", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({})) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });

    await expect(
      provider.createSession({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        session: { provider: "openai" },
      }),
    ).rejects.toMatchObject({
      name: "CharivoProviderError",
      code: "CHARIVO_PROVIDER_ERROR",
      message: "OpenAI Realtime Error: invalid client secret response",
    });
  });

  it("throws CharivoTimeoutError when the request times out", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    ) as typeof fetch;

    const provider = new OpenAIRealtimeProvider({ apiKey: "key" });
    const request = provider.createSession({
      transport: "webrtc",
      sdpOffer: "offer-sdp",
      session: { provider: "openai" },
    });

    const expectation = expect(request).rejects.toMatchObject({
      name: "CharivoTimeoutError",
      code: "CHARIVO_TIMEOUT_ERROR",
      message: "OpenAI realtime request timed out after 30000ms",
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
