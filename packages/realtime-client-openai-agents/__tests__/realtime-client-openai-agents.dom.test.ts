import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";
import { OpenAIRealtimeAgentsClient } from "@charivo/realtime-client-openai-agents";
import type { RealtimeTransportEvent } from "@charivo/realtime-core";

type Listener = (...args: unknown[]) => void;
type ListenerMap = Map<string, Set<Listener>>;

class MockEmitter {
  private listeners: ListenerMap = new Map();

  on(event: string, callback: Listener): void {
    const current = this.listeners.get(event) ?? new Set();
    current.add(callback);
    this.listeners.set(event, current);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(event) ?? []) {
      callback(...args);
    }
  }
}

const sdkState = vi.hoisted(() => ({
  session: null as MockRealtimeSession | null,
  transport: null as MockRealtimeTransport | null,
  audioElement: null as HTMLAudioElement | null,
}));

class MockRealtimeTransport extends MockEmitter {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
    sdkState.transport = this;
    sdkState.audioElement = options.audioElement as HTMLAudioElement;
  }

  close(): void {
    this.emit("connection_change", "disconnected");
  }

  interrupt(): void {
    this.emit("audio_interrupted");
  }
}

class MockRealtimeAgent {
  name: string;
  instructions: string;
  tools: Array<Record<string, unknown>>;
  voice?: string;

  constructor(config: {
    name: string;
    instructions: string;
    tools: Array<Record<string, unknown>>;
    voice?: string;
  }) {
    this.name = config.name;
    this.instructions = config.instructions;
    this.tools = config.tools;
    this.voice = config.voice;
  }
}

class MockRealtimeSession extends MockEmitter {
  initialAgent: MockRealtimeAgent;
  options: Record<string, unknown>;
  history: unknown[] = [];
  connect = vi.fn(async (_options: Record<string, unknown>) => undefined);
  sendMessage = vi.fn((_text: string) => undefined);
  close = vi.fn(() => {
    sdkState.transport?.emit("connection_change", "disconnected");
  });
  interrupt = vi.fn(() => {
    sdkState.transport?.emit("audio_interrupted");
  });

  constructor(agent: MockRealtimeAgent, options: Record<string, unknown>) {
    super();
    this.initialAgent = agent;
    this.options = options;
    sdkState.session = this;
  }
}

class MockAnalyser {
  fftSize = 256;
  smoothingTimeConstant = 0.8;
  frequencyBinCount = 4;

  getByteFrequencyData(target: Uint8Array): void {
    target.fill(128);
  }
}

class MockAudioContext {
  analyser = new MockAnalyser();
  createMediaStreamSource = vi.fn((_stream: MediaStream) => ({
    connect: vi.fn(),
  }));
  createAnalyser = vi.fn(() => this.analyser);
  close = vi.fn(async () => undefined);
}

class MockMediaStream {}

vi.mock("@openai/agents-realtime", () => ({
  OpenAIRealtimeWebRTC: vi.fn((options) => new MockRealtimeTransport(options)),
  RealtimeAgent: vi.fn((config) => new MockRealtimeAgent(config)),
  RealtimeSession: vi.fn(
    (agent, options) => new MockRealtimeSession(agent, options),
  ),
  tool: vi.fn((options) => options),
}));

const originalFetch = globalThis.fetch;
const originalAudioContext = window.AudioContext;
const originalMediaStream = globalThis.MediaStream;

beforeEach(() => {
  sdkState.session = null;
  sdkState.transport = null;
  sdkState.audioElement = null;
  vi.useFakeTimers();
  Object.defineProperty(window, "AudioContext", {
    value: MockAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MediaStream", {
    value: MockMediaStream,
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(window, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "MediaStream", {
    value: originalMediaStream,
    configurable: true,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenAIRealtimeAgentsClient", () => {
  it("connects with an ephemeral bootstrap and sends text through the session", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
      model: "gpt-realtime-mini",
      voice: "marin",
    });
    await client.sendText("hello");

    expect(sdkState.session?.connect).toHaveBeenCalledWith({
      apiKey: "client-secret",
      model: "gpt-realtime-mini",
    });
    expect(sdkState.session?.sendMessage).toHaveBeenCalledWith("hello");
    expect(sdkState.session?.options.config).not.toHaveProperty("tools");
    expect(events).toContainEqual({ type: "session.started" });
  });

  it("normalizes assistant transcript deltas and final history text", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    sdkState.transport?.emit("audio_transcript_delta", {
      itemId: "item-1",
      responseId: "resp-1",
      delta: "Hel",
    });
    sdkState.session?.emit("history_updated", [
      {
        itemId: "item-1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_audio",
            transcript: "Hello there",
          },
        ],
      },
    ]);
    sdkState.session?.emit("agent_end", {}, {}, "Hello there");

    expect(events).toContainEqual({ type: "assistant.response.started" });
    expect(events).toContainEqual({
      type: "assistant.text.delta",
      text: "Hel",
    });
    expect(events).toContainEqual({
      type: "assistant.text.delta",
      text: "lo there",
    });
    expect(events).toContainEqual({
      type: "assistant.response.completed",
      text: "Hello there",
    });
  });

  it("maps user transcript and audio lifecycle events", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
    });

    sdkState.session?.emit("transport_event", {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello there",
    });
    sdkState.session?.emit("audio_start", {}, {});
    sdkState.session?.emit("audio_stopped", {}, {});

    expect(events).toContainEqual({
      type: "user.transcript",
      text: "hello there",
    });
    expect(events).toContainEqual({ type: "audio.output.started" });
    expect(events).toContainEqual({ type: "audio.output.ended" });
  });

  it("proxies tool calls and resolves results by callId", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
      tools: [
        {
          type: "function",
          name: "setEmotion",
          description: "Update emotion",
          parameters: {
            type: "object",
            properties: {
              emotion: { type: "string" },
            },
          },
        },
      ],
    });

    const proxyTool = sdkState.session?.initialAgent.tools[0] as {
      execute: (
        input: Record<string, unknown>,
        _context?: unknown,
        details?: { toolCall?: { callId?: string } },
      ) => Promise<Record<string, unknown>>;
    };
    const pendingResult = proxyTool.execute({ emotion: "happy" }, undefined, {
      toolCall: { callId: "call-1" },
    });

    expect(events).toContainEqual({
      type: "tool.call",
      name: "setEmotion",
      args: { emotion: "happy" },
      callId: "call-1",
    });

    await client.sendToolResult("call-1", {
      success: true,
      emotion: "happy",
    });

    await expect(pendingResult).resolves.toEqual({
      success: true,
      emotion: "happy",
    });
  });

  it("keeps pending tool calls alive across interrupt and rejects them on disconnect", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
      tools: [
        {
          type: "function",
          name: "setEmotion",
          description: "Update emotion",
          parameters: {
            type: "object",
            properties: {
              emotion: { type: "string" },
            },
          },
        },
      ],
    });

    const proxyTool = sdkState.session?.initialAgent.tools[0] as {
      execute: (
        input: Record<string, unknown>,
        _context?: unknown,
        details?: { toolCall?: { callId?: string } },
      ) => Promise<Record<string, unknown>>;
    };
    const stillPending = proxyTool.execute({ emotion: "happy" }, undefined, {
      toolCall: { callId: "call-keep" },
    });

    await client.interrupt();
    await client.sendToolResult("call-keep", { success: true });
    await expect(stillPending).resolves.toEqual({ success: true });
    expect(
      events.filter((event) => event.type === "audio.output.ended"),
    ).toHaveLength(1);

    const doomed = proxyTool.execute({ emotion: "sad" }, undefined, {
      toolCall: { callId: "call-drop" },
    });

    await client.disconnect();

    await expect(doomed).rejects.toThrow(
      "Realtime session ended before tool result was returned",
    );
  });

  it("derives lip sync from the MediaStream on the audio element and resets on disconnect", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
    });

    const stream = new MediaStream();
    if (sdkState.audioElement) {
      sdkState.audioElement.srcObject = stream;
      sdkState.audioElement.dispatchEvent(new Event("loadedmetadata"));
    }

    await vi.advanceTimersByTimeAsync(20);

    expect(
      events.some((event) => event.type === "audio.lipsync" && event.rms > 0),
    ).toBe(true);

    await client.disconnect();

    expect(events).toContainEqual({
      type: "audio.lipsync",
      rms: 0,
    });
  });

  it("can fall back to peer connection track events for lip sync analysis", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });
    const events: RealtimeTransportEvent[] = [];
    client.onEvent((event) => events.push(event));

    await client.connect({
      provider: "openai",
    });

    const listeners = new Map<string, ((event: Event) => void)[]>();
    const peerConnection = {
      addEventListener: (name: string, listener: (event: Event) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      },
    } as unknown as RTCPeerConnection;

    const changePeerConnection = sdkState.transport?.options
      .changePeerConnection as (
      pc: RTCPeerConnection,
    ) => Promise<RTCPeerConnection>;
    await changePeerConnection(peerConnection);

    const stream = new MediaStream();
    for (const listener of listeners.get("track") ?? []) {
      listener({
        streams: [stream],
      } as unknown as Event);
    }

    await vi.advanceTimersByTimeAsync(20);

    expect(
      events.some((event) => event.type === "audio.lipsync" && event.rms > 0),
    ).toBe(true);
  });

  it("notifies multiple listeners", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        clientSecret: "client-secret",
      }),
    ) as typeof fetch;

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const client = new OpenAIRealtimeAgentsClient({
      apiEndpoint: "/api/realtime",
    });

    client.onEvent(firstListener);
    client.onEvent(secondListener);

    await client.connect({
      provider: "openai",
    });

    expect(firstListener).toHaveBeenCalledWith({ type: "session.started" });
    expect(secondListener).toHaveBeenCalledWith({ type: "session.started" });
  });
});
