import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_LIVE_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";

const createSession = vi.fn();
const createGeminiSession = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAIRealtimeProvider: vi.fn(() => ({
    createSession,
  })),
}));

vi.mock("@charivo/server/gemini", () => ({
  createGeminiRealtimeProvider: vi.fn(() => ({
    createSession: createGeminiSession,
  })),
}));

import { POST } from "./route";
import {
  REALTIME_GEMINI_MODEL,
  REALTIME_MAX_INSTRUCTIONS_CHARS,
  REALTIME_MAX_OUTPUT_TOKENS,
  REALTIME_MAX_TOOLS,
  REALTIME_MAX_TOOLS_BYTES,
  REALTIME_OPENAI_MODEL,
  TTS_FALLBACK_VOICE,
} from "../demo-limits";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/realtime", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const GEMINI_BOOTSTRAP = {
  adapter: GEMINI_LIVE_ADAPTER,
  transport: "websocket",
  url: "wss://gemini.example/live",
  token: "ephemeral-token",
};

describe("examples/web /api/realtime route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    createSession.mockReset();
    createGeminiSession.mockReset();
  });

  it("forwards the selected adapter to the realtime provider", async () => {
    createSession.mockResolvedValue({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });

    const request = new Request("http://localhost/api/realtime", {
      method: "POST",
      body: JSON.stringify({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        session: {
          provider: "openai",
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const response = await POST(request as never);

    expect(createSession).toHaveBeenCalledWith({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      session: {
        provider: "openai",
        model: REALTIME_OPENAI_MODEL,
        maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      },
      sdpOffer: undefined,
    });
    await expect(response.json()).resolves.toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
  });

  it("pins the model server-side and ignores the caller's choice", async () => {
    createSession.mockResolvedValue({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });

    await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          model: "gpt-4o-realtime-preview",
          maxTokens: 1_000_000,
        },
      }) as never,
    );

    const session = createSession.mock.calls[0][0].session;
    expect(session.model).toBe(REALTIME_OPENAI_MODEL);
    expect(session.maxTokens).toBe(REALTIME_MAX_OUTPUT_TOKENS);
  });

  it("rejects instructions longer than the demo cap", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          instructions: "x".repeat(REALTIME_MAX_INSTRUCTIONS_CHARS + 1),
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects more tools than the demo cap", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          tools: Array.from({ length: REALTIME_MAX_TOOLS + 1 }, () => ({
            type: "function",
            name: "noop",
            description: "",
            parameters: { type: "object", properties: {} },
          })),
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("drops a voice that no shipped character uses", async () => {
    createSession.mockResolvedValue({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });

    await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "openai", voice: "not-a-demo-voice" },
      }) as never,
    );

    expect(createSession.mock.calls[0][0].session.voice).toBeUndefined();
  });

  it("rejects a toolChoice outside the accepted set", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "openai", toolChoice: "whatever-i-want" },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("measures the tool budget in UTF-8 bytes, not UTF-16 code units", async () => {
    // Each of these is 1 UTF-16 code unit but 3 UTF-8 bytes, so a payload that
    // looks legal by .length is over the real wire budget.
    const filler = "\u4e00".repeat(REALTIME_MAX_TOOLS_BYTES - 200);
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          tools: [
            {
              type: "function",
              name: "noop",
              description: filler,
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      }) as never,
    );

    expect(filler.length).toBeLessThan(REALTIME_MAX_TOOLS_BYTES);
    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("routes a gemini session to the Gemini provider", async () => {
    createGeminiSession.mockResolvedValue(GEMINI_BOOTSTRAP);

    const response = await POST(
      postRequest({
        adapter: GEMINI_LIVE_ADAPTER,
        transport: "websocket",
        session: { provider: "gemini", instructions: "Be brief." },
      }) as never,
    );

    expect(createGeminiSession).toHaveBeenCalledWith({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      session: {
        provider: "gemini",
        model: REALTIME_GEMINI_MODEL,
        maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
        instructions: "Be brief.",
      },
      sdpOffer: undefined,
    });
    expect(createSession).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(GEMINI_BOOTSTRAP);
  });

  it("pins the gemini model server-side and ignores the caller's choice", async () => {
    createGeminiSession.mockResolvedValue(GEMINI_BOOTSTRAP);

    await POST(
      postRequest({
        transport: "websocket",
        session: {
          provider: "gemini",
          model: "gemini-2.5-pro",
          maxTokens: 1_000_000,
        },
      }) as never,
    );

    const session = createGeminiSession.mock.calls[0][0].session;
    expect(session.model).toBe(REALTIME_GEMINI_MODEL);
    expect(session.maxTokens).toBe(REALTIME_MAX_OUTPUT_TOKENS);
  });

  it("keeps voice and input transcription out of the gemini session", async () => {
    createGeminiSession.mockResolvedValue(GEMINI_BOOTSTRAP);

    await POST(
      postRequest({
        transport: "websocket",
        session: {
          provider: "gemini",
          // Both are values the OpenAI path would have forwarded — a voice in
          // the allowlist, and a transcription block whose `enabled: true` is
          // what makes that path emit it at all — so this proves the gemini
          // assembler drops them rather than an upstream filter doing it.
          voice: TTS_FALLBACK_VOICE,
          inputAudioTranscription: { enabled: true, model: "whisper-1" },
        },
      }) as never,
    );

    const session = createGeminiSession.mock.calls[0][0].session;
    expect(session).not.toHaveProperty("voice");
    expect(session).not.toHaveProperty("inputAudioTranscription");
  });

  it("rejects a toolChoice the Gemini Live API cannot express", async () => {
    const response = await POST(
      postRequest({
        transport: "websocket",
        session: { provider: "gemini", toolChoice: "required" },
      }) as never,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("session.toolChoice");
    expect(createGeminiSession).not.toHaveBeenCalled();
  });

  it("answers webrtc on the gemini path with 400, not the provider's 500", async () => {
    const response = await POST(
      postRequest({
        adapter: GEMINI_LIVE_ADAPTER,
        transport: "webrtc",
        session: { provider: "gemini" },
      }) as never,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("transport must be");
    expect(createGeminiSession).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a non-Gemini adapter for the gemini provider", async () => {
    const response = await POST(
      postRequest({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "websocket",
        session: { provider: "gemini" },
      }) as never,
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("adapter must be");
    expect(createGeminiSession).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("lets a gemini session through when the caller names no adapter", async () => {
    createGeminiSession.mockResolvedValue(GEMINI_BOOTSTRAP);

    const response = await POST(
      postRequest({
        transport: "websocket",
        session: { provider: "gemini" },
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(createGeminiSession.mock.calls[0][0].adapter).toBeUndefined();
  });

  it("rejects instructions longer than the demo cap on the gemini path", async () => {
    const response = await POST(
      postRequest({
        transport: "websocket",
        session: {
          provider: "gemini",
          instructions: "x".repeat(REALTIME_MAX_INSTRUCTIONS_CHARS + 1),
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createGeminiSession).not.toHaveBeenCalled();
  });

  it("rejects oversized tools on the gemini path", async () => {
    const response = await POST(
      postRequest({
        transport: "websocket",
        session: {
          provider: "gemini",
          tools: [
            {
              type: "function",
              name: "noop",
              description: "x".repeat(REALTIME_MAX_TOOLS_BYTES + 1),
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createGeminiSession).not.toHaveBeenCalled();
  });

  it("fails closed when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const response = await POST(
      postRequest({
        transport: "websocket",
        session: { provider: "gemini" },
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "GEMINI_API_KEY not configured",
    });
    expect(createGeminiSession).not.toHaveBeenCalled();
  });

  it("mints a gemini session without an OpenAI key", async () => {
    delete process.env.OPENAI_API_KEY;
    createGeminiSession.mockResolvedValue(GEMINI_BOOTSTRAP);

    const response = await POST(
      postRequest({
        transport: "websocket",
        session: { provider: "gemini" },
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(GEMINI_BOOTSTRAP);
  });

  it("answers an unrecognized provider with 501", async () => {
    const response = await POST(
      postRequest({
        transport: "websocket",
        session: { provider: "anthropic" },
      }) as never,
    );

    expect(response.status).toBe(501);
    expect(createSession).not.toHaveBeenCalled();
    expect(createGeminiSession).not.toHaveBeenCalled();
  });
});
