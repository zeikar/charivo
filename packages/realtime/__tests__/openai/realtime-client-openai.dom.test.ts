import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeClient } from "@charivo/realtime/openai";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import type { RealtimeTransportEvent } from "@charivo/realtime";

type RealtimeClientTestInternals = OpenAIRealtimeClient & {
  audioElement: HTMLAudioElement | null;
  setupAudioAnalysis: (stream: MediaStream) => void;
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
  dataChannel = new MockDataChannel();
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
  addTrack = vi.fn(() => undefined);
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

    const internals = client as unknown as RealtimeClientTestInternals;
    const setupAudioAnalysisSpy = vi
      .spyOn(internals, "setupAudioAnalysis")
      .mockImplementation(() => undefined);

    await client.connect({
      provider: "openai",
      model: "gpt-realtime-mini",
      voice: "marin",
    });

    const peer = MockPeerConnection.instances[0]!;
    expect(peer.addTrack).toHaveBeenCalledWith(localTrack, localStream);
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

    peer.ontrack?.({ streams: [remoteStream] } as unknown as RTCTrackEvent);
    expect(internals.audioElement?.srcObject).toBe(remoteStream);
    expect(setupAudioAnalysisSpy).toHaveBeenCalledWith(remoteStream);
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
