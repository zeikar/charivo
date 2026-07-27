import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  type STTOptions,
  type STTTranscriber,
} from "@charivo/core";
import {
  createOpenAIRealtimeSTTTranscriber,
  type OpenAIRealtimeTranscriptionBootstrap,
  type OpenAIRealtimeTranscriptionSessionRequest,
} from "@charivo/stt/openai-realtime";

const DELTA = "conversation.item.input_audio_transcription.delta";
const COMPLETED = "conversation.item.input_audio_transcription.completed";
const FAILED = "conversation.item.input_audio_transcription.failed";
const COMMITTED = "input_audio_buffer.committed";
const COMMIT = "input_audio_buffer.commit";

class MockMediaTrack {
  enabled = true;
  stop = vi.fn(() => undefined);
}

class MockDataChannel {
  readyState: RTCDataChannelState = "connecting";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn((_payload: string) => undefined);
  // A real data channel fires onclose when it is closed, so the mock does too:
  // teardown must not classify its own close as a session failure.
  close = vi.fn(() => {
    this.readyState = "closed";
    this.onclose?.();
  });
}

class MockPeerConnection {
  static instances: MockPeerConnection[] = [];

  iceConnectionState: RTCIceConnectionState = "new";
  connectionState: RTCPeerConnectionState = "new";
  dataChannel = new MockDataChannel();
  private listeners = new Map<string, Set<() => void>>();
  createDataChannel = vi.fn(
    (_label: string) => this.dataChannel as unknown as RTCDataChannel,
  );
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
  setLocalDescription = vi.fn(
    async (_desc: RTCSessionDescriptionInit) => undefined,
  );
  setRemoteDescription = vi.fn(
    async (_desc: RTCSessionDescriptionInit) => undefined,
  );
  addTrack = vi.fn(() => ({}) as unknown as RTCRtpSender);
  addEventListener = vi.fn((event: string, listener: () => void) => {
    const current = this.listeners.get(event) ?? new Set<() => void>();
    current.add(listener);
    this.listeners.set(event, current);
  });
  close = vi.fn(() => undefined);

  constructor() {
    MockPeerConnection.instances.push(this);
  }

  dispatch(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

const createBootstrapMock = () =>
  vi.fn(
    async (
      _request: OpenAIRealtimeTranscriptionSessionRequest,
    ): Promise<OpenAIRealtimeTranscriptionBootstrap> => ({
      answerSdp: "answer-sdp",
    }),
  );

const originalPeerConnection = globalThis.RTCPeerConnection;

let tracks: MockMediaTrack[] = [];
let mediaStream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let bootstrap: ReturnType<typeof createBootstrapMock>;

// Enough microtask turns to fully drain the mocked start/stop promise chains.
const MICROTASK_TURNS = 50;
const flush = async () => {
  for (let index = 0; index < MICROTASK_TURNS; index += 1) {
    await Promise.resolve();
  }
};

const latestPeer = () => MockPeerConnection.instances.at(-1)!;
const latestChannel = () => latestPeer().dataChannel;

/**
 * Record how a promise settled, keeping the reason so an unexpected early
 * settlement reports the real error instead of a bare boolean mismatch. The
 * handlers attach synchronously, which is what keeps late rejections from
 * surfacing as unhandled-rejection noise.
 */
const trackSettlement = (promise: Promise<unknown>) => {
  const state: {
    outcome: null | { status: "resolved" | "rejected"; value: unknown };
  } = { outcome: null };
  void promise.then(
    (value) => {
      state.outcome = { status: "resolved", value };
    },
    (error: unknown) => {
      state.outcome = { status: "rejected", value: error };
    },
  );
  return state;
};

const expectRejectsWith = async (
  promise: Promise<unknown>,
  errorType: new (...args: never[]) => Error,
  message: string,
) => {
  await expect(promise).rejects.toBeInstanceOf(errorType);
  await expect(promise).rejects.toThrow(message);
};

const createTranscriber = (): STTTranscriber =>
  createOpenAIRealtimeSTTTranscriber({ bootstrap });

const openChannel = (channel: MockDataChannel = latestChannel()) => {
  channel.readyState = "open";
  channel.onopen?.();
};

const startAndOpen = async (
  transcriber: STTTranscriber,
  options?: STTOptions,
) => {
  const started = transcriber.startRecording(options);
  await flush();
  openChannel();
  await started;
};

const feedRaw = (data: string, channel: MockDataChannel = latestChannel()) => {
  channel.onmessage?.(new MessageEvent("message", { data }));
};

const feed = (event: unknown, channel: MockDataChannel = latestChannel()) => {
  feedRaw(JSON.stringify(event), channel);
};

const commitCount = (channel: MockDataChannel = latestChannel()) =>
  channel.send.mock.calls.filter(
    ([payload]) => (JSON.parse(payload) as { type: string }).type === COMMIT,
  ).length;

const deltaEvent = (itemId: string, delta: string) => ({
  type: DELTA,
  item_id: itemId,
  delta,
});

const completedEvent = (itemId: string, transcript: string) => ({
  type: COMPLETED,
  item_id: itemId,
  transcript,
});

const committedEvent = (itemId: string, previousItemId: string | null) => ({
  type: COMMITTED,
  item_id: itemId,
  previous_item_id: previousItemId,
});

/** Deliver the stop commit ack plus the authoritative transcript for one item. */
const deliverFinal = (itemId: string, transcript: string) => {
  feed(committedEvent(itemId, null));
  feed(completedEvent(itemId, transcript));
};

/** A terminal server event must reject the pending stop, never be dropped. */
const expectTerminalStop = async (
  deliver: () => void,
  expectedMessage: string,
) => {
  const transcriber = createTranscriber();
  await startAndOpen(transcriber);

  const stopped = transcriber.stopRecording();
  const rejection = expectRejectsWith(
    stopped,
    CharivoProviderError,
    expectedMessage,
  );
  await flush();

  deliver();

  await rejection;
  expect(transcriber.isRecording()).toBe(false);
};

beforeEach(() => {
  vi.useFakeTimers();
  MockPeerConnection.instances = [];
  // Captured per test: jsdom's window outlives a test, so a session left
  // recording must never reach the next test's tracks through `pagehide`.
  const sessionTracks: MockMediaTrack[] = [new MockMediaTrack()];
  tracks = sessionTracks;
  mediaStream = {
    getTracks: () => sessionTracks,
    getAudioTracks: () => sessionTracks,
  } as unknown as MediaStream;
  getUserMedia = vi.fn(async () => mediaStream);
  bootstrap = createBootstrapMock();

  Object.defineProperty(globalThis, "RTCPeerConnection", {
    value: MockPeerConnection,
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    value: originalPeerConnection,
    configurable: true,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenAIRealtimeSTTTranscriber", () => {
  it("negotiates the session through the injected bootstrap and starts recording", async () => {
    const transcriber = createTranscriber();

    await startAndOpen(transcriber, { language: "ko" });

    const peer = MockPeerConnection.instances[0]!;
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(peer.addTrack).toHaveBeenCalledWith(tracks[0], mediaStream);
    expect(peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(peer.setLocalDescription).toHaveBeenCalledWith({
      type: "offer",
      sdp: "offer-sdp",
    });
    expect(bootstrap).toHaveBeenCalledWith({
      sdpOffer: "offer-sdp",
      session: { model: "gpt-realtime-whisper", language: "ko" },
    });
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(transcriber.isRecording()).toBe(true);
    expect(commitCount()).toBe(0);
  });

  it("arms the open gate only after the SDP exchange so a slow bootstrap cannot trip it", async () => {
    let resolveBootstrap!: (
      value: OpenAIRealtimeTranscriptionBootstrap,
    ) => void;
    bootstrap.mockImplementation(
      () =>
        new Promise<OpenAIRealtimeTranscriptionBootstrap>((resolve) => {
          resolveBootstrap = resolve;
        }),
    );

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);
    await flush();

    // Longer than OPEN_TIMEOUT_MS (10s) but shorter than BOOTSTRAP_TIMEOUT_MS (15s).
    await vi.advanceTimersByTimeAsync(12_000);
    expect(state.outcome).toBeNull();

    resolveBootstrap({ answerSdp: "answer-sdp" });
    await flush();
    openChannel();
    await started;

    expect(transcriber.isRecording()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CharivoTimeoutError when the bootstrap never resolves", async () => {
    bootstrap.mockImplementation(
      () => new Promise<OpenAIRealtimeTranscriptionBootstrap>(() => {}),
    );

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoTimeoutError,
      "streaming STT bootstrap timed out after 15000ms",
    );

    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects promptly when the peer connection fails while the bootstrap is in flight", async () => {
    bootstrap.mockImplementation(
      () => new Promise<OpenAIRealtimeTranscriptionBootstrap>(() => {}),
    );

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoProviderError,
      "connection failed",
    );
    await flush();

    const peer = MockPeerConnection.instances[0]!;
    peer.connectionState = "failed";
    peer.dispatch("connectionstatechange");

    // Settles without advancing to BOOTSTRAP_TIMEOUT_MS.
    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits cumulative partial snapshots from live deltas without sending any commit", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));
    await startAndOpen(transcriber);

    feed(deltaEvent("item-1", "Hello"));
    feed(deltaEvent("item-1", " there"));
    // Unrecognized event types are ignored, not treated as text or as errors.
    feed({ type: "conversation.item.added", item_id: "item-1" });
    feed(deltaEvent("item-1", " friend"));

    expect(commitCount()).toBe(0);
    expect(partials).toEqual(["Hello", "Hello there", "Hello there friend"]);
    expect(transcriber.isRecording()).toBe(true);
  });

  it("concatenates model-spaced deltas verbatim", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));
    await startAndOpen(transcriber);

    feed(deltaEvent("item-1", "Hello"));
    feed(deltaEvent("item-1", " world"));

    expect(partials.at(-1)).toBe("Hello world");
  });

  it("concatenates CJK deltas without inserting separators", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));
    await startAndOpen(transcriber);

    feed(deltaEvent("item-1", "你好"));
    feed(deltaEvent("item-1", "世界"));

    expect(partials.at(-1)).toBe("你好世界");
  });

  it("appends deltas per item and snapshots them in conversation order", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));
    await startAndOpen(transcriber);

    // Only `committed` carries `previous_item_id`; deltas arrive out of order.
    feed(committedEvent("item-b", "item-a"));
    feed(committedEvent("item-a", null));
    feed(deltaEvent("item-b", " world"));
    feed(deltaEvent("item-a", "Hello"));

    expect(partials).toEqual([" world", "Hello world"]);
  });

  it("sends exactly one commit at stop and resolves the trimmed authoritative final", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    feed(deltaEvent("item-1", "Hello"));

    const stopped = transcriber.stopRecording();
    const state = trackSettlement(stopped);
    await flush();

    expect(commitCount()).toBe(1);
    expect(state.outcome).toBeNull();

    feed(committedEvent("item-1", null));
    await flush();
    expect(state.outcome).toBeNull();

    feed(completedEvent("item-1", "  Hello world.  "));

    await expect(stopped).resolves.toBe("Hello world.");
    expect(commitCount()).toBe(1);
  });

  it("prefers the authoritative completed transcript over the streamed deltas", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));
    await startAndOpen(transcriber);

    feed(deltaEvent("item-1", "helo"));
    feed(deltaEvent("item-1", " wrld"));
    expect(partials.at(-1)).toBe("helo wrld");

    const stopped = transcriber.stopRecording();
    await flush();
    deliverFinal("item-1", "Hello world");

    // The snapshot switches to the transcript even though the item still
    // carries its (non-empty) draft deltas.
    expect(partials.at(-1)).toBe("Hello world");
    await expect(stopped).resolves.toBe("Hello world");
  });

  it("joins multiple items in conversation order from previous_item_id, not arrival order", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    await flush();

    // Arrival order is B then A; conversation order is A then B.
    feed(committedEvent("item-b", "item-a"));
    feed(committedEvent("item-a", null));
    feed(completedEvent("item-b", " world"));
    feed(completedEvent("item-a", "Hello"));

    await expect(stopped).resolves.toBe("Hello world");
  });

  it("keeps the stop pending until a conversation-earlier item completes", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    const state = trackSettlement(stopped);
    await flush();

    feed(committedEvent("stop-item", "earlier-item"));
    feed(committedEvent("earlier-item", null));
    feed(completedEvent("stop-item", " tail"));
    await flush();

    expect(state.outcome).toBeNull();

    feed(completedEvent("earlier-item", "head"));

    await expect(stopped).resolves.toBe("head tail");
  });

  it("ignores a stale pre-stop commit and waits for the stop commit's own item", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    // A server-segmented item is fully committed and completed before stop.
    feed(committedEvent("early-item", null));
    feed(completedEvent("early-item", "First half"));

    const stopped = transcriber.stopRecording();
    const state = trackSettlement(stopped);
    await flush();

    expect(commitCount()).toBe(1);
    expect(state.outcome).toBeNull();

    feed(committedEvent("stop-item", "early-item"));
    await flush();
    expect(state.outcome).toBeNull();

    feed(completedEvent("stop-item", " second half"));

    await expect(stopped).resolves.toBe("First half second half");
  });

  it("disables every audio track as soon as stop is requested", async () => {
    tracks.push(new MockMediaTrack());
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    expect(tracks.map((track) => track.enabled)).toEqual([true, true]);

    const stopped = transcriber.stopRecording();
    expect(tracks.map((track) => track.enabled)).toEqual([false, false]);

    await flush();
    deliverFinal("item-1", "done");
    await expect(stopped).resolves.toBe("done");
  });

  it("commits and awaits the authoritative final when stop happens before the first delta", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    const state = trackSettlement(stopped);
    await flush();

    expect(commitCount()).toBe(1);
    expect(state.outcome).toBeNull();

    deliverFinal("item-1", "Hi there.");

    await expect(stopped).resolves.toBe("Hi there.");
  });

  it("rejects the stop when the commit reports an empty audio buffer", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    const rejection = expectRejectsWith(
      stopped,
      CharivoProviderError,
      "Error committing input audio buffer: the buffer is empty.",
    );
    await flush();

    feed({
      type: "error",
      error: {
        code: "input_audio_buffer_commit_empty",
        message: "Error committing input audio buffer: the buffer is empty.",
      },
    });

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CharivoTimeoutError when the final transcript never arrives", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    feed(deltaEvent("item-1", "orphan draft"));

    const stopped = transcriber.stopRecording();
    const rejection = expectRejectsWith(
      stopped,
      CharivoTimeoutError,
      "stop timed out after 5000ms waiting for the final transcript",
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a malformed completed event as terminal", async () => {
    await expectTerminalStop(
      () => feed({ type: COMPLETED, item_id: "item-1" }),
      "malformed completed event",
    );
    await expectTerminalStop(
      () => feed({ type: COMPLETED, item_id: "item-1", transcript: 42 }),
      "malformed completed event",
    );
    await expectTerminalStop(
      () => feed({ type: COMPLETED, transcript: "orphan" }),
      "malformed completed event",
    );
  });

  it("treats a malformed delta event as terminal", async () => {
    await expectTerminalStop(
      () => feed({ type: DELTA, item_id: "item-1" }),
      "malformed delta event",
    );
    await expectTerminalStop(
      () => feed({ type: DELTA, delta: "orphan" }),
      "malformed delta event",
    );
  });

  it("treats a malformed committed event as terminal", async () => {
    await expectTerminalStop(
      () => feed({ type: COMMITTED, previous_item_id: null }),
      "malformed committed event",
    );
    await expectTerminalStop(
      () => feed({ type: COMMITTED, item_id: "item-1", previous_item_id: 7 }),
      "malformed committed event",
    );
  });

  it("accepts a committed event whose previous_item_id is null or absent", async () => {
    const withNull = createTranscriber();
    await startAndOpen(withNull);
    const nullStop = withNull.stopRecording();
    await flush();
    feed({ type: COMMITTED, item_id: "item-1", previous_item_id: null });
    feed(completedEvent("item-1", "rooted by null"));
    await expect(nullStop).resolves.toBe("rooted by null");

    const withoutKey = createTranscriber();
    await startAndOpen(withoutKey);
    const absentStop = withoutKey.stopRecording();
    await flush();
    feed({ type: COMMITTED, item_id: "item-1" });
    feed(completedEvent("item-1", "rooted by absence"));
    await expect(absentStop).resolves.toBe("rooted by absence");
  });

  it("keeps items the previous_item_id chain never links, in arrival order", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    await flush();

    // Two roots: the chain walk reaches only the first, so the second must
    // degrade to arrival order instead of being dropped from the transcript.
    feed(committedEvent("item-1", null));
    feed(committedEvent("item-2", null));
    feed(completedEvent("item-2", " second"));
    feed(completedEvent("item-1", "First"));

    await expect(stopped).resolves.toBe("First second");
  });

  it("treats a malformed failed event as terminal", async () => {
    await expectTerminalStop(
      () => feed({ type: FAILED, error: { message: "no item id" } }),
      "malformed failed event",
    );
    await expectTerminalStop(
      () => feed({ type: FAILED, item_id: 9, error: { message: "bad id" } }),
      "malformed failed event",
    );
  });

  it("treats non-JSON and non-object payloads as terminal", async () => {
    await expectTerminalStop(
      () => feedRaw("not json at all"),
      "malformed realtime event",
    );
    await expectTerminalStop(() => feed(42), "invalid realtime event");
    await expectTerminalStop(() => feed(null), "invalid realtime event");
    await expectTerminalStop(
      () => feed({ item_id: "item-1" }),
      "invalid realtime event",
    );
  });

  it("requires a well-formed error object on failed and error events", async () => {
    await expectTerminalStop(
      () => feed({ type: FAILED, item_id: "item-1" }),
      "malformed failed event",
    );
    await expectTerminalStop(
      () => feed({ type: FAILED, item_id: "item-1", error: { code: "oops" } }),
      "malformed failed event",
    );
    await expectTerminalStop(
      () => feed({ type: FAILED, item_id: "item-1", error: "boom" }),
      "malformed failed event",
    );
    await expectTerminalStop(
      () => feed({ type: "error" }),
      "malformed error event",
    );
    await expectTerminalStop(
      () => feed({ type: "error", error: { message: 5 } }),
      "malformed error event",
    );
  });

  it("surfaces the message from a well-formed failed or error event", async () => {
    await expectTerminalStop(
      () =>
        feed({
          type: FAILED,
          item_id: "item-1",
          error: { code: "transcription_failed", message: "audio too noisy" },
        }),
      "audio too noisy",
    );
    await expectTerminalStop(
      () => feed({ type: "error", error: { message: "session exploded" } }),
      "session exploded",
    );
  });

  it("surfaces a mid-session failure on the next stop exactly once", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    feed({ type: "error", error: { message: "session exploded" } });
    // cleanup() already bumped the generation, so dc.onmessage drops this one
    // outright and the first cause is what the next stop reports.
    feed({ type: "error", error: { message: "second boom" } });

    expect(transcriber.isRecording()).toBe(false);
    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoProviderError,
      "session exploded",
    );
    await expect(transcriber.stopRecording()).resolves.toBe("");
  });

  it("rejects a concurrent stop with CharivoStateError", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const first = transcriber.stopRecording();
    const state = trackSettlement(first);

    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoStateError,
      "stop already in progress",
    );
    expect(state.outcome).toBeNull();
    expect(commitCount()).toBe(1);

    deliverFinal("item-1", "done");
    await expect(first).resolves.toBe("done");
  });

  it("rejects a stop while the session is still connecting, then stops normally once started", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    await flush();

    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoStateError,
      "cannot stop while the streaming session is still starting",
    );

    openChannel();
    await started;
    expect(transcriber.isRecording()).toBe(true);

    const stopped = transcriber.stopRecording();
    await flush();
    deliverFinal("item-1", "late but fine");

    await expect(stopped).resolves.toBe("late but fine");
  });

  it("rejects the pending stop when the data channel closes unexpectedly", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    const rejection = expectRejectsWith(
      stopped,
      CharivoProviderError,
      "data channel closed",
    );
    await flush();

    latestChannel().onclose?.();

    await rejection;
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start when the data channel errors while the open gate is armed", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoProviderError,
      "data channel error",
    );
    await flush();

    latestChannel().onerror?.();

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the stop instead of hanging when the commit cannot be sent", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const sendFailure = new Error("channel is closed");
    latestChannel().send.mockImplementation(() => {
      throw sendFailure;
    });

    await expect(transcriber.stopRecording()).rejects.toBe(sendFailure);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the pending stop when the peer connection fails while recording", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    const rejection = expectRejectsWith(
      stopped,
      CharivoProviderError,
      "connection failed",
    );
    await flush();

    const peer = latestPeer();
    peer.connectionState = "failed";
    peer.dispatch("connectionstatechange");

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the next stop when the ICE connection fails while recording", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const peer = latestPeer();
    peer.iceConnectionState = "failed";
    peer.dispatch("iceconnectionstatechange");

    expect(transcriber.isRecording()).toBe(false);
    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoProviderError,
      "connection failed",
    );
  });

  it("does not classify a normal teardown as a failure", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    await flush();
    deliverFinal("item-1", "all good");

    await expect(stopped).resolves.toBe("all good");
    // cleanup() closed the data channel, which fires onclose on a real channel.
    expect(latestChannel().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    await expect(transcriber.stopRecording()).resolves.toBe("");
  });

  it("rejects and closes the peer connection when microphone access is denied", async () => {
    const denial = new Error("denied");
    getUserMedia.mockRejectedValue(denial);

    const transcriber = createTranscriber();

    await expect(transcriber.startRecording()).rejects.toBe(denial);
    expect(MockPeerConnection.instances).toHaveLength(1);
    expect(MockPeerConnection.instances[0]!.close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects and cleans up when the bootstrap fails", async () => {
    const failure = new Error("bootstrap rejected");
    bootstrap.mockRejectedValue(failure);

    const transcriber = createTranscriber();

    await expect(transcriber.startRecording()).rejects.toBe(failure);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestChannel().close).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CharivoTimeoutError when the data channel never opens", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoTimeoutError,
      "streaming STT data channel did not open within 10000ms",
    );
    await flush();

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a reentrant start without creating a second peer connection", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);

    await expectRejectsWith(
      transcriber.startRecording(),
      CharivoStateError,
      "already recording",
    );
    expect(MockPeerConnection.instances).toHaveLength(1);
    expect(state.outcome).toBeNull();

    await flush();
    openChannel();
    await started;

    await expectRejectsWith(
      transcriber.startRecording(),
      CharivoStateError,
      "already recording",
    );
    expect(MockPeerConnection.instances).toHaveLength(1);
  });

  it("releases the microphone, channel, peer, and timers on a normal stop", async () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stopped = transcriber.stopRecording();
    await flush();
    deliverFinal("item-1", "released");

    await expect(stopped).resolves.toBe("released");
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestChannel().close).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith(
      "pagehide",
      expect.any(Function),
    );
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tears down the session on pagehide and removes the listener", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    window.dispatchEvent(new Event("pagehide"));

    expect(transcriber.isRecording()).toBe(false);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestPeer().close).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pagehide"));

    expect(latestPeer().close).toHaveBeenCalledTimes(1);
    await expect(transcriber.stopRecording()).resolves.toBe("");
  });

  it("ignores events from a stale session and runs two sequential sessions cleanly", async () => {
    const partials: string[] = [];
    const transcriber = createTranscriber();
    transcriber.onPartial?.((transcription) => partials.push(transcription));

    await startAndOpen(transcriber);
    const staleChannel = latestChannel();
    const firstStop = transcriber.stopRecording();
    await flush();
    deliverFinal("item-1", "first session");
    await expect(firstStop).resolves.toBe("first session");

    // Late events from the torn-down session must not touch the next one.
    feed(deltaEvent("item-1", " ghost"), staleChannel);
    feed({ type: "error", error: { message: "stale boom" } }, staleChannel);
    feed({ type: COMMITTED, item_id: 0 }, staleChannel);

    await startAndOpen(transcriber);
    expect(MockPeerConnection.instances).toHaveLength(2);
    expect(commitCount()).toBe(0);

    // Handlers still bound to the closed channel must not reopen or fail the
    // live session either.
    staleChannel.onopen?.();
    staleChannel.onerror?.();
    expect(transcriber.isRecording()).toBe(true);

    const secondStop = transcriber.stopRecording();
    await flush();
    deliverFinal("item-2", "second session");

    await expect(secondStop).resolves.toBe("second session");
    expect(partials).toEqual(["first session", "second session"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
