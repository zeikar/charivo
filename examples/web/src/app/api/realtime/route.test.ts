import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";

const createSession = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAIRealtimeProvider: vi.fn(() => ({
    createSession,
  })),
}));

import { POST } from "./route";
import {
  REALTIME_MAX_INSTRUCTIONS_CHARS,
  REALTIME_MAX_OUTPUT_TOKENS,
  REALTIME_MAX_TOOLS,
  REALTIME_MODEL,
} from "../demo-limits";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/realtime", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/web /api/realtime route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    createSession.mockReset();
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
        model: REALTIME_MODEL,
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
    expect(session.model).toBe(REALTIME_MODEL);
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
});
