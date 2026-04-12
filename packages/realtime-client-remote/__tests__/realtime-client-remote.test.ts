import { afterEach, describe, expect, it, vi } from "vitest";

const transportClient = {
  connect: vi.fn(async (_config?: unknown) => undefined),
  disconnect: vi.fn(async () => undefined),
  sendText: vi.fn(async (_text: string) => undefined),
  sendAudio: vi.fn(async (_audio: ArrayBuffer) => undefined),
  interrupt: vi.fn(async () => undefined),
  onEvent: vi.fn((_callback: (event: unknown) => void) => undefined),
};

const transportState = vi.hoisted(() => ({
  bootstrap: null as unknown,
  options: null as unknown,
}));

vi.mock("@charivo/realtime-client-openai", () => ({
  createOpenAIRealtimeClient: vi.fn((options) => {
    transportState.options = options;
    transportClient.connect.mockImplementationOnce(async (config?: unknown) => {
      transportState.bootstrap = await options.sessionBootstrap({
        transport: "webrtc",
        session: config ?? {},
        sdpOffer: "offer-sdp",
      });
    });
    return transportClient;
  }),
}));

import { RemoteRealtimeClient } from "../src";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  transportState.bootstrap = null;
  transportState.options = null;
  transportClient.connect.mockClear();
  transportClient.disconnect.mockClear();
  transportClient.sendText.mockClear();
  transportClient.sendAudio.mockClear();
  transportClient.interrupt.mockClear();
  transportClient.onEvent.mockClear();
});

describe("RemoteRealtimeClient", () => {
  it("requests bootstrap JSON from the server route", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            transport: "webrtc",
            answerSdp: "answer-sdp",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;

    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      model: "gpt-realtime-mini",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/realtime",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(transportState.bootstrap).toEqual({
      transport: "webrtc",
      answerSdp: "answer-sdp",
    });
  });
});
