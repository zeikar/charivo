import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";

const createSession = vi.fn();

vi.mock("@charivo/realtime-provider-openai", () => ({
  createOpenAIRealtimeProvider: vi.fn(() => ({
    createSession,
  })),
}));

import { POST } from "./route";

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
      },
      sdpOffer: undefined,
    });
    await expect(response.json()).resolves.toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
  });
});
