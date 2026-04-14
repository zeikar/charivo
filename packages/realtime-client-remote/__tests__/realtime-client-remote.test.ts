import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OPENAI_REALTIME_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";

const agentsTransportState = vi.hoisted(() => ({
  bootstrap: null as unknown,
  options: null as unknown,
  callbacks: [] as Array<(event: unknown) => void>,
}));

const agentsTransportClient = {
  connect: vi.fn(async (_config?: unknown) => {
    const options = agentsTransportState.options as {
      sessionBootstrap: (request: unknown) => Promise<unknown>;
    };
    agentsTransportState.bootstrap = await options.sessionBootstrap({
      transport: "webrtc",
      session: _config ?? {},
    });
    for (const callback of agentsTransportState.callbacks) {
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
    agentsTransportState.callbacks.push(callback);
  }),
};

const legacyTransportState = vi.hoisted(() => ({
  bootstrap: null as unknown,
  options: null as unknown,
  callbacks: [] as Array<(event: unknown) => void>,
}));

const legacyTransportClient = {
  connect: vi.fn(async (_config?: unknown) => {
    const options = legacyTransportState.options as {
      sessionBootstrap: (request: unknown) => Promise<unknown>;
    };
    legacyTransportState.bootstrap = await options.sessionBootstrap({
      transport: "webrtc",
      session: _config ?? {},
      sdpOffer: "offer-sdp",
    });
    for (const callback of legacyTransportState.callbacks) {
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
    legacyTransportState.callbacks.push(callback);
  }),
};

vi.mock("@charivo/realtime-client-openai-agents", () => ({
  createOpenAIRealtimeAgentsClient: vi.fn((options) => {
    agentsTransportState.options = options;
    return agentsTransportClient;
  }),
}));

vi.mock("@charivo/realtime-client-openai", () => ({
  createOpenAIRealtimeClient: vi.fn((options) => {
    legacyTransportState.options = options;
    return legacyTransportClient;
  }),
}));

import { RemoteRealtimeClient } from "../src";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  agentsTransportState.bootstrap = null;
  agentsTransportState.options = null;
  agentsTransportState.callbacks = [];
  legacyTransportState.bootstrap = null;
  legacyTransportState.options = null;
  legacyTransportState.callbacks = [];
  agentsTransportClient.connect.mockClear();
  agentsTransportClient.disconnect.mockClear();
  agentsTransportClient.sendText.mockClear();
  agentsTransportClient.sendAudio.mockClear();
  agentsTransportClient.sendToolResult.mockClear();
  agentsTransportClient.interrupt.mockClear();
  agentsTransportClient.onEvent.mockClear();
  legacyTransportClient.connect.mockClear();
  legacyTransportClient.disconnect.mockClear();
  legacyTransportClient.sendText.mockClear();
  legacyTransportClient.sendAudio.mockClear();
  legacyTransportClient.sendToolResult.mockClear();
  legacyTransportClient.interrupt.mockClear();
  legacyTransportClient.onEvent.mockClear();
});

describe("RemoteRealtimeClient", () => {
  it("requests adapter-aware bootstrap JSON and forwards pre-connect listeners", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
            transport: "webrtc",
            clientSecret: "client-secret",
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
    expect(agentsTransportState.bootstrap).toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
    expect(
      JSON.parse(
        String(
          (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
            ?.body,
        ),
      ),
    ).toMatchObject({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
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
            clientSecret: "client-secret",
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
            adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
            transport: "webrtc",
            clientSecret: "client-secret",
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

    expect(agentsTransportClient.sendToolResult).toHaveBeenCalledWith(
      "call-1",
      {
        success: true,
      },
    );
  });

  it("can explicitly resolve the legacy adapter", async () => {
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
      resolveAdapterId: () => OPENAI_REALTIME_ADAPTER,
    });

    await client.connect({
      provider: "openai",
    });

    expect(legacyTransportState.bootstrap).toEqual({
      adapter: OPENAI_REALTIME_ADAPTER,
      transport: "webrtc",
      answerSdp: "answer-sdp",
    });
  });
});
