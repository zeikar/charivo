import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeClient } from "@charivo/realtime-client-openai";

type RealtimeClientTestInternals = OpenAIRealtimeClient & {
  audioElement: HTMLAudioElement | null;
  setupAudioAnalysis: (stream: MediaStream) => void;
};

class MockMediaTrack {
  stop = vi.fn(() => undefined);
}

class MockDataChannel {
  readyState: RTCDataChannelState = "open";
  onopen: (() => void) | null = null;
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
  it("connects successfully, posts SDP, and attaches remote audio tracks", async () => {
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
      async () => new Response("answer-sdp"),
    ) as typeof fetch;

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    const internals = client as unknown as RealtimeClientTestInternals;
    const setupAudioAnalysisSpy = vi
      .spyOn(internals, "setupAudioAnalysis")
      .mockImplementation(() => undefined);

    await client.connect({
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

    peer.ontrack?.({ streams: [remoteStream] } as unknown as RTCTrackEvent);

    expect(internals.audioElement?.srcObject).toBe(remoteStream);
    expect(setupAudioAnalysisSpy).toHaveBeenCalledWith(remoteStream);
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

  it("cleans up when the session bootstrap API fails", async () => {
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
      async () => new Response("backend failed", { status: 500 }),
    ) as typeof fetch;

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });

    await expect(client.connect()).rejects.toThrow(
      "Failed to create Realtime session: backend failed",
    );
    expect(localTrack.stop).toHaveBeenCalledTimes(1);
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

  it("sends user messages and blocks duplicate sends until response completion", async () => {
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
      async () => new Response("answer-sdp"),
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

    expect(peer.dataChannel.send).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "⚠️ Response already in progress, skipping request",
    );

    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "response.done" }),
      }),
    );

    await client.sendText("after done");
    expect(peer.dataChannel.send).toHaveBeenCalledTimes(4);
  });

  it("relays server events and resets in-progress state on error", async () => {
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
      async () => new Response("answer-sdp"),
    ) as typeof fetch;

    const textDelta = vi.fn();
    const audioDelta = vi.fn();
    const audioDone = vi.fn();
    const toolCall = vi.fn();
    const onError = vi.fn();

    const client = new OpenAIRealtimeClient({
      apiEndpoint: "/api/realtime",
    });
    client.onTextDelta(textDelta);
    client.onAudioDelta(audioDelta);
    client.onAudioDone(audioDone);
    client.onToolCall(toolCall);
    client.onError(onError);

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
        data: JSON.stringify({ type: "response.audio.done" }),
      }),
    );
    peer.dataChannel.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "response.function_call_arguments.done",
          call_id: "call-1",
          name: "setEmotion",
          arguments: JSON.stringify({ emotion: "happy" }),
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

    expect(textDelta).toHaveBeenCalledWith("hel");
    expect(audioDelta).toHaveBeenCalledWith("base64-audio");
    expect(audioDone).toHaveBeenCalledTimes(1);
    expect(toolCall).toHaveBeenCalledWith("setEmotion", { emotion: "happy" });
    expect(onError).toHaveBeenCalledWith(new Error("boom"));

    await client.sendText("after error");
    expect(peer.dataChannel.send).toHaveBeenCalledTimes(6);
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
