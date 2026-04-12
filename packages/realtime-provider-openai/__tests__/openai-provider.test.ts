import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import { OpenAIRealtimeProvider } from "../src";

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
              name: "setEmotion",
              description: "Update emotion",
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
            name: "setEmotion",
            description: "Update emotion",
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
});
