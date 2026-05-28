import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeClient } from "@charivo/realtime/openai";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import type { RealtimeTransportEvent } from "@charivo/realtime";

type RealtimeClientTestInternals = OpenAIRealtimeClient & {
  audioElement: HTMLAudioElement | null;
  lipSyncAnalyzer: { attachStream: (stream: MediaStream) => void };
};

class MockMediaTrack {
  stop = vi.fn(() => undefined);
}

class MockDataChannel {
  readyState: RTCDataChannelState = "open";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn((_payload: string) => undefined);
  close = vi.fn(() => {
    this.readyState = "closed";
  });
}

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];

  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  iceConnectionState: RTCIceConnectionState = "new";
  connectionState: RTCPeerConnectionState = "new";
  dataChannel = new MockDataChannel();
  private listeners = new Map<string, Set<() => void>>();
  createDataChannel = vi.fn(
    () => this.dataChannel as unknown as RTCDataChannel,
  );
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
  setLocalDescription = vi.fn(
    async (_desc: RTCSessionDescriptionInit) => undefined,
  );
  setRemoteDescription = vi.fn(
    async (_desc: RTCSessionDescriptionInit) => undefined,
  );
  addTrack = vi.fn(
    () =>
      ({
        track: { kind: "audio" },
        replaceTrack: vi.fn(async () => undefined),
      }) as unknown as RTCRtpSender,
  );
  getSenders = vi.fn(() =>
    [this.addTrack.mock.results[0]?.value].filter(Boolean),
  );
  addEventListener = vi.fn((event: string, listener: () => void) => {
    const current = this.listeners.get(event) ?? new Set();
    current.add(listener);
    this.listeners.set(event, current);
  });
  restartIce = vi.fn(() => undefined);
  close = vi.fn(() => undefined);

  constructor() {
    MockPeerConnection.instances.push(this);
  }
}

const originalFetch = globalThis.fetch;
const originalPeerConnection = globalThis.RTCPeerConnection;
const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

beforeEach(() => {
  MockPeerConnection.instances = [];
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    value: MockPeerConnection,
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    value: originalPeerConnection,
    configurable: true,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenAIRealtimeClient", () => {
  it("connects successfully and supports JSON bootstrap responses", async () => {
    const localTrack = new MockMediaTrack();
    const localStream = {
      getTracks: () => [localTrack],
    } as unknown as MediaStream;
    const remoteStream = {} as MediaStream;
    const getUserMedia = vi.fn(async () => localStream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia,
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    const internals = client as unknown as RealtimeClientTestInternals;
    const attachStreamSpy = vi
      .spyOn(internals.lipSyncAnalyzer, "attachStream")
      .mockImplementation(() => undefined);

    await client.connect({
      provider: "openai",
      model: "gpt-realtime-mini",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    expect(peer.addTrack).toHaveBeenCalledWith(localTrack, localStream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/realtime",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(events).toContainEqual({ type: "session.started" });
    expect(internals.audioElement?.getAttribute("playsinline")).toBe("true");

    peer.ontrack?.({ streams: [remoteStream] } as unknown as RTCTrackEvent);
    expect(internals.audioElement?.srcObject).toBe(remoteStream);
    expect(attachStreamSpy).toHaveBeenCalledWith(remoteStream);
  });

  it("rejects invalid bootstrap payloads", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await expect(client.connect()).rejects.toThrow(
      "Invalid realtime session bootstrap response",
    );
  });

  it("cleans up when microphone access is denied", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
      configurable: true,
    });

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await expect(client.connect()).rejects.toThrow(
      "Microphone access required for Realtime API",
    );
    expect(MockPeerConnection.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("cleans up when the session bootstrap request times out", async () => {
    vi.useFakeTimers();
    const localTrack = new MockMediaTrack();
    const localStream = {
      getTracks: () => [localTrack],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    const request = client.connect();
    const expectation = expect(request).rejects.toThrow(
      "Realtime session request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
    expect(localTrack.stop).toHaveBeenCalledTimes(1);
    expect(MockPeerConnection.instances[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("patches the active session by sending session.update and awaiting ack", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "alloy",
      temperature: 0.2,
      maxTokens: 200,
      tools: [
        {
          type: "function",
          name: "wave",
          description: "Wave to the user.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      ],
    });

    expect(peer.dataChannel.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: "session.update",
        event_id: "charivo-session-update-1",
        session: {
          audio: {
            output: {
              voice: "alloy",
            },
          },
          tool_choice: "auto",
          temperature: 0.2,
          max_response_output_tokens: 200,
          tools: [
            {
              type: "function",
              name: "wave",
              description: "Wave to the user.",
              parameters: {
                type: "object",
                properties: {},
              },
            },
          ],
        },
      }),
    );

    peer.dataChannel.onmessage?.({
      data: JSON.stringify({
        type: "session.updated",
      }),
    } as MessageEvent);

    await updatePromise;
  });

  it("falls back to the OpenAI default voice for empty session patches", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
    });

    expect(peer.dataChannel.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: "session.update",
        event_id: "charivo-session-update-1",
        session: {
          audio: {
            output: {
              voice: "marin",
            },
          },
          tool_choice: "auto",
        },
      }),
    );

    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.updated",
          event_id: "charivo-session-update-1",
        }),
      }),
    );

    await updatePromise;
  });

  it("includes audio.input.transcription.model when inputAudioTranscription.model is set", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "marin",
      inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
    });

    const sendPayload = peer.dataChannel.send.mock.calls.at(-1)?.[0] as string;
    const parsed = JSON.parse(sendPayload) as Record<string, unknown>;
    const session = parsed.session as Record<string, unknown>;
    const audio = session.audio as Record<string, unknown>;
    expect(audio.input).toEqual({
      transcription: { model: "gpt-4o-mini-transcribe" },
    });

    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.updated",
          event_id: "charivo-session-update-1",
        }),
      }),
    );

    await updatePromise;
  });

  it("disables input transcription by sending audio.input.transcription: null when enabled is false", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "marin",
      inputAudioTranscription: { enabled: false },
    });

    const sendPayload = peer.dataChannel.send.mock.calls.at(-1)?.[0] as string;
    const parsed = JSON.parse(sendPayload) as Record<string, unknown>;
    const session = parsed.session as Record<string, unknown>;
    const audio = session.audio as Record<string, unknown>;
    expect(audio.input).toEqual({ transcription: null });

    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.updated",
          event_id: "charivo-session-update-1",
        }),
      }),
    );

    await updatePromise;
  });

  it("input transcription enabled: false overrides model when both are supplied", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "marin",
      inputAudioTranscription: {
        enabled: false,
        model: "gpt-4o-mini-transcribe",
      },
    });

    const sendPayload = peer.dataChannel.send.mock.calls.at(-1)?.[0] as string;
    const parsed = JSON.parse(sendPayload) as Record<string, unknown>;
    const session = parsed.session as Record<string, unknown>;
    const audio = session.audio as Record<string, unknown>;
    expect(audio.input).toEqual({ transcription: null });

    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "session.updated",
          event_id: "charivo-session-update-1",
        }),
      }),
    );

    await updatePromise;
  });

  it("rebuilds the transport on recover when the peer connection has failed", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_ADAPTER,
        transport: "webrtc",
        answerSdp: "answer-sdp",
      }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    peer.connectionState = "failed";

    await client.recover({
      provider: "openai",
      voice: "alloy",
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(MockPeerConnection.instances).toHaveLength(2);
  });

  it("labels online lifecycle recovery attempts with the online cause", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        adapter: OPENAI_REALTIME_ADAPTER,
        transport: "webrtc",
        answerSdp: "answer-sdp",
      }),
    ) as typeof fetch;

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    peer.connectionState = "failed";

    window.dispatchEvent(new Event("online"));

    expect(events).toContainEqual({
      type: "connection.lost",
      cause: "online",
      error: undefined,
    });
  });

  it("ignores unrelated server errors while a session patch is pending", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "alloy",
    });
    const onRejected = vi.fn();

    void updatePromise.catch(onRejected);

    peer.dataChannel.onmessage?.({
      data: JSON.stringify({
        type: "error",
        error: {
          message: "tool failed",
          event_id: "different-event",
        },
      }),
    } as MessageEvent);
    await Promise.resolve();

    expect(onRejected).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "error",
      error: expect.objectContaining({
        message: "tool failed",
      }),
    });

    peer.dataChannel.onmessage?.({
      data: JSON.stringify({
        type: "session.updated",
      }),
    } as MessageEvent);

    await updatePromise;
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("rejects session patches that never receive a session.updated ack", async () => {
    vi.useFakeTimers();
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "alloy",
    });
    const expectation = expect(updatePromise).rejects.toThrow(
      "Timed out waiting for session.updated after 5000ms",
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expectation;
  });

  it("uses a custom session patch timeout when configured", async () => {
    vi.useFakeTimers();
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
      sessionUpdateTimeoutMs: 1_234,
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });

    const updatePromise = client.updateSession({
      provider: "openai",
      voice: "alloy",
    });
    const expectation = expect(updatePromise).rejects.toThrow(
      "Timed out waiting for session.updated after 1234ms",
    );

    await vi.advanceTimersByTimeAsync(1_234);

    await expectation;
  });

  it("rejects session patches while an assistant response is in progress", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect({
      provider: "openai",
      voice: "marin",
    });
    await client.sendText("hello");

    await expect(
      client.updateSession({
        provider: "openai",
        voice: "alloy",
      }),
    ).rejects.toThrow(
      "Cannot update the realtime session while a response is in progress. Call interrupt() first.",
    );
  });

  it("sends user messages, blocks duplicate sends, and supports interruption", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect();
    const peer = MockPeerConnection.instances[0]!;

    await client.sendText("hello");
    await client.sendText("blocked");
    await client.interrupt();

    expect(peer.dataChannel.send).toHaveBeenCalledTimes(3);
    expect(peer.dataChannel.send).toHaveBeenNthCalledWith(
      3,
      JSON.stringify({ type: "response.cancel" }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "⚠️ Response already in progress, skipping request",
    );
  });

  it("normalizes assistant, transcript, tool, and error events", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();
    await client.sendText("hello");

    const peer = MockPeerConnection.instances[0]!;
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.audio_transcript.delta",
          delta: "hel",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.audio.delta",
          delta: "base64-audio",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          transcript: "hello there",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "call-1",
          name: "setExpression",
          arguments: JSON.stringify({ expressionId: "Smile" }),
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.audio.done",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "error",
          error: { message: "boom" },
        }),
      }),
    );

    expect(events).toContainEqual({ type: "assistant.response.started" });
    expect(events).toContainEqual({
      type: "assistant.text.delta",
      text: "hel",
    });
    expect(events).toContainEqual({ type: "audio.output.started" });
    expect(events).toContainEqual({ type: "audio.output.ended" });
    expect(events).toContainEqual({
      type: "user.transcript",
      text: "hello there",
    });
    expect(events).toContainEqual({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Smile" },
      callId: "call-1",
    });
    expect(events).toContainEqual({
      type: "assistant.response.completed",
      text: "hel",
    });
    expect(events).toContainEqual({
      type: "error",
      error: new Error("boom"),
    });
  });

  it("emits a single completion per user turn even when tool calls split it", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();

    const peer = MockPeerConnection.instances[0]!;

    // Sub-cycle 1: tool call + response.done with no accumulated text.
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "call-1",
          name: "setExpression",
          arguments: JSON.stringify({ expressionId: "Smile" }),
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );

    // Sub-cycle 2: post-tool audio transcript streams in, then response.done.
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.audio_transcript.delta",
          delta: "Hello there",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );

    const starts = events.filter(
      (event) => event.type === "assistant.response.started",
    );
    const completions = events.filter(
      (event) => event.type === "assistant.response.completed",
    );

    expect(starts).toHaveLength(1);
    expect(completions).toHaveLength(1);
    expect(completions[0]).toEqual({
      type: "assistant.response.completed",
      text: "Hello there",
    });
  });

  it("swallows late completion events after interrupt", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();
    await client.sendText("hello");
    await client.interrupt();

    const peer = MockPeerConnection.instances[0]!;
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.audio_transcript.delta",
          delta: "ignored",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );

    expect(events).not.toContainEqual({
      type: "assistant.text.delta",
      text: "ignored",
    });
    expect(events).not.toContainEqual({
      type: "assistant.response.completed",
      text: "",
    });
  });

  it("streams assistant text from response.output_text events", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();
    await client.sendText("hello");

    const peer = MockPeerConnection.instances[0]!;
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.output_text.delta",
          delta: "Hel",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.output_text.done",
          text: "Hello there",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );

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

  it("streams assistant audio transcripts from output_audio_transcript events", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const events: RealtimeTransportEvent[] = [];
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();
    await client.sendText("hello");

    const peer = MockPeerConnection.instances[0]!;
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.output_audio_transcript.delta",
          delta: "Hel",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.output_audio_transcript.done",
          transcript: "Hello there",
        }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.done",
        }),
      }),
    );

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

  it("submits tool results through the OpenAI wire format", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.connect();
    await client.sendToolResult("call-1", {
      success: true,
      expressionId: "Smile",
    });

    const peer = MockPeerConnection.instances[0]!;
    expect(peer.dataChannel.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({
            success: true,
            expressionId: "Smile",
          }),
        },
      }),
    );
    expect(peer.dataChannel.send).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ type: "response.create" }),
    );
  });

  it("notifies multiple event listeners", async () => {
    const localStream = {
      getTracks: () => [new MockMediaTrack()],
    } as unknown as MediaStream;

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => localStream),
      },
      configurable: true,
    });
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

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onEvent(firstListener);
    client.onEvent(secondListener);

    await client.connect();

    expect(firstListener).toHaveBeenCalledWith({ type: "session.started" });
    expect(secondListener).toHaveBeenCalledWith({ type: "session.started" });
  });

  it("warns when sendAudio is called explicitly", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await client.sendAudio(new ArrayBuffer(4));

    expect(warnSpy).toHaveBeenCalledWith(
      "sendAudio is not needed with WebRTC - audio is automatically transmitted",
    );
  });
});
