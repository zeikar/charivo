import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";

const transportState = vi.hoisted(() => ({
  bootstrap: null as unknown,
  options: null as unknown,
  callbacks: [] as Array<(event: unknown) => void>,
}));

const transportClient = {
  connect: vi.fn(async (_config?: unknown) => {
    const options = transportState.options as {
      sessionBootstrap: (request: unknown) => Promise<unknown>;
    };
    transportState.bootstrap = await options.sessionBootstrap({
      transport: "webrtc",
      session: _config ?? {},
      sdpOffer: "offer-sdp",
    });
    for (const callback of transportState.callbacks) {
      callback({ type: "session.started" });
    }
  }),
  disconnect: vi.fn(async () => undefined),
  sendText: vi.fn(async (_text: string) => undefined),
  sendAudio: vi.fn(async (_audio: ArrayBuffer) => undefined),
  sendToolResult: vi.fn(
    async (_callId: string, _output: Record<string, unknown>) => undefined,
  ),
  interrupt: vi.fn(async () => undefined),
  onEvent: vi.fn((callback: (event: unknown) => void) => {
    transportState.callbacks.push(callback);
  }),
};

vi.mock("@charivo/realtime-client-openai", () => ({
  createOpenAIRealtimeClient: vi.fn((options) => {
    transportState.options = options;
    return transportClient;
  }),
}));

import { RemoteRealtimeClient } from "../src";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  transportState.bootstrap = null;
  transportState.options = null;
  transportState.callbacks = [];
  transportClient.connect.mockClear();
  transportClient.disconnect.mockClear();
  transportClient.sendText.mockClear();
  transportClient.sendAudio.mockClear();
  transportClient.sendToolResult.mockClear();
  transportClient.interrupt.mockClear();
  transportClient.onEvent.mockClear();
});

describe("RemoteRealtimeClient", () => {
  it("requests adapter-aware bootstrap JSON and forwards pre-connect listeners", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: OPENAI_REALTIME_ADAPTER,
            transport: "webrtc",
            answerSdp: "answer-sdp",
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        ),
    ) as typeof fetch;

    const listener = vi.fn();
    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent(listener);

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
      adapter: OPENAI_REALTIME_ADAPTER,
      transport: "webrtc",
      answerSdp: "answer-sdp",
    });
    expect(listener).toHaveBeenCalledWith({ type: "session.started" });
  });

  it("rejects unknown adapters from the resolver", async () => {
    const client = new RemoteRealtimeClient({
      resolveAdapterId: () => "missing-adapter",
    });

    await expect(
      client.connect({
        provider: "openai",
      }),
    ).rejects.toThrow('No realtime adapter registered for "missing-adapter"');
  });

  it("rejects mismatched bootstrap adapters", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: "different-adapter",
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

    await expect(
      client.connect({
        provider: "openai",
      }),
    ).rejects.toThrow("Realtime session bootstrap adapter mismatch");
  });

  it("errors when interrupt is called without an active transport", async () => {
    const client = new RemoteRealtimeClient();

    await expect(client.interrupt()).rejects.toThrow(
      "Realtime session not active",
    );
  });

  it("forwards tool results to the active transport", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: OPENAI_REALTIME_ADAPTER,
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
    });
    await client.sendToolResult("call-1", { success: true });

    expect(transportClient.sendToolResult).toHaveBeenCalledWith("call-1", {
      success: true,
    });
  });
});
