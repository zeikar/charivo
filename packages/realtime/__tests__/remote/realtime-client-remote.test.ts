import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_LIVE_ADAPTER,
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
  updateSession: vi.fn(async (_config?: unknown) => undefined),
  recover: vi.fn(async (_config?: unknown) => undefined),
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
  prepareAudio: vi.fn(async () => undefined),
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
  updateSession: vi.fn(async (_config?: unknown) => undefined),
  recover: vi.fn(async (_config?: unknown) => undefined),
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

vi.mock("@charivo/realtime/openai-agents", () => ({
  createOpenAIRealtimeAgentsClient: vi.fn((options) => {
    agentsTransportState.options = options;
    return agentsTransportClient;
  }),
}));

vi.mock("@charivo/realtime/openai", () => ({
  createOpenAIRealtimeClient: vi.fn((options) => {
    legacyTransportState.options = options;
    return legacyTransportClient;
  }),
}));

const geminiTransportState = vi.hoisted(() => ({
  bootstrap: null as unknown,
  options: null as unknown,
}));

const geminiTransportClient = {
  connect: vi.fn(async (_config?: unknown) => {
    const options = geminiTransportState.options as {
      sessionBootstrap: (request: unknown) => Promise<unknown>;
    };
    geminiTransportState.bootstrap = await options.sessionBootstrap({
      transport: "websocket",
      session: _config ?? {},
    });
  }),
  updateSession: vi.fn(async (_config?: unknown) => undefined),
  recover: vi.fn(async (_config?: unknown) => undefined),
  disconnect: vi.fn(async () => undefined),
  sendText: vi.fn(async (_text: string) => undefined),
  sendAudio: vi.fn(async (_audio: ArrayBuffer) => undefined),
  sendToolResult: vi.fn(
    async (_callId: string, _output: Record<string, unknown>) => undefined,
  ),
  interrupt: vi.fn(async () => undefined),
  onEvent: vi.fn((_callback: (event: unknown) => void) => undefined),
};

vi.mock("@charivo/realtime/gemini", () => ({
  createGeminiLiveClient: vi.fn((options) => {
    geminiTransportState.options = options;
    return geminiTransportClient;
  }),
}));

import { RemoteRealtimeClient } from "../../src/remote/client";
import { createOpenAIRealtimeAgentsClient } from "@charivo/realtime/openai-agents";

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
  agentsTransportClient.updateSession.mockClear();
  agentsTransportClient.recover.mockClear();
  agentsTransportClient.sendText.mockClear();
  agentsTransportClient.sendAudio.mockClear();
  agentsTransportClient.sendToolResult.mockClear();
  agentsTransportClient.interrupt.mockClear();
  agentsTransportClient.onEvent.mockClear();
  agentsTransportClient.prepareAudio.mockClear();
  vi.mocked(createOpenAIRealtimeAgentsClient).mockClear();
  legacyTransportClient.connect.mockClear();
  legacyTransportClient.disconnect.mockClear();
  legacyTransportClient.updateSession.mockClear();
  legacyTransportClient.recover.mockClear();
  legacyTransportClient.sendText.mockClear();
  legacyTransportClient.sendAudio.mockClear();
  legacyTransportClient.sendToolResult.mockClear();
  legacyTransportClient.interrupt.mockClear();
  legacyTransportClient.onEvent.mockClear();
  geminiTransportState.bootstrap = null;
  geminiTransportState.options = null;
  geminiTransportClient.connect.mockClear();
  geminiTransportClient.disconnect.mockClear();
  geminiTransportClient.updateSession.mockClear();
  geminiTransportClient.recover.mockClear();
  geminiTransportClient.sendText.mockClear();
  geminiTransportClient.sendAudio.mockClear();
  geminiTransportClient.sendToolResult.mockClear();
  geminiTransportClient.interrupt.mockClear();
  geminiTransportClient.onEvent.mockClear();
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

  it("forwards recover calls to the active transport", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });
    await client.recover({
      provider: "openai",
      voice: "alloy",
    });

    expect(agentsTransportClient.recover).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );
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

  it("forwards session updates to the active transport", async () => {
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
    await client.updateSession({
      provider: "openai",
      voice: "alloy",
    });

    expect(agentsTransportClient.updateSession).toHaveBeenCalledWith({
      provider: "openai",
      voice: "alloy",
    });
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

  it("resolves the Gemini adapter for a websocket transport", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: GEMINI_LIVE_ADAPTER,
            transport: "websocket",
            url: "wss://example.test",
            token: "gemini-token",
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
      provider: "gemini",
      transport: "websocket",
    });

    expect(
      JSON.parse(
        String(
          (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
            ?.body,
        ),
      ),
    ).toMatchObject({
      adapter: GEMINI_LIVE_ADAPTER,
    });
    expect(geminiTransportState.bootstrap).toEqual({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: "wss://example.test",
      token: "gemini-token",
    });
  });

  it("does not resolve the Gemini adapter when transport is omitted", async () => {
    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await expect(
      client.connect({
        provider: "gemini",
      }),
    ).rejects.toThrow(
      'No remote realtime adapter resolver for provider "gemini" and transport "webrtc"',
    );
  });

  it("rejects a mismatched bootstrap adapter for the Gemini transport", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: "different-adapter",
            transport: "websocket",
            url: "wss://example.test",
            token: "gemini-token",
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
        provider: "gemini",
        transport: "websocket",
      }),
    ).rejects.toThrow("Realtime session bootstrap adapter mismatch");
  });

  it("prepares the resolved adapter and connect() reuses the same instance", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.prepareAudio({ provider: "openai" });
    expect(agentsTransportClient.prepareAudio).toHaveBeenCalledTimes(1);
    expect(createOpenAIRealtimeAgentsClient).toHaveBeenCalledTimes(1);

    await client.connect({ provider: "openai" });
    expect(createOpenAIRealtimeAgentsClient).toHaveBeenCalledTimes(1);
    expect(agentsTransportClient.connect).toHaveBeenCalledTimes(1);
    expect(agentsTransportClient.disconnect).not.toHaveBeenCalled();
  });

  it("forwards listeners registered between prepareAudio and connect to the prepared adapter", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.prepareAudio({ provider: "openai" });

    const listener = vi.fn();
    client.onEvent(listener);
    expect(agentsTransportClient.onEvent).toHaveBeenCalledWith(listener);

    await client.connect({ provider: "openai" });
    expect(listener).toHaveBeenCalledWith({ type: "session.started" });
  });

  it("disconnect() releases a prepared-but-unconnected adapter", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new RemoteRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.prepareAudio({ provider: "openai" });
    await client.disconnect();

    expect(agentsTransportClient.disconnect).toHaveBeenCalledTimes(1);
  });
});
