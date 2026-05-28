import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENAI_REALTIME_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";
import { OpenAIRealtimeProvider } from "../../../src/openai/realtime";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
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
});
