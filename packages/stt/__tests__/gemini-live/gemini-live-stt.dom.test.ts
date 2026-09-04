import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  type STTOptions,
  type STTTranscriber,
} from "@charivo/core";
import {
  createGeminiLiveSTTTranscriber,
  type GeminiLiveTranscriptionBootstrap,
  type GeminiLiveTranscriptionSessionRequest,
} from "@charivo/stt/gemini-live";
// The pipeline is internal to the transcriber, so its flush contract is
// exercised directly rather than through the public entry point.
import {
  CAPTURE_WORKLET_SOURCE,
  createCapturePipeline,
} from "../../src/gemini-live/capture";

const SOCKET_URL = "wss://generativelanguage.example/ws";
// Every reserved character the query parameter has to survive.
const TOKEN = "tok en/+&";
const ENCODED_TOKEN = "tok%20en%2F%2B%26";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  send = vi.fn((payload: string) => {
    this.sent.push(payload);
  });
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  /** The browser's open event; the client answers it with the setup frame. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** One server frame, delivered the way the browser delivers it. */
  deliver(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: false } as unknown as CloseEvent);
  }

  emitError(): void {
    this.onerror?.();
  }
}

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  readonly streamSources: MockAudioNode[] = [];
  readonly audioWorklet = {
    addModule: vi.fn((url: string) => addModule(url)),
  };

  createMediaStreamSource = vi.fn(() => {
    const source = new MockAudioNode();
    this.streamSources.push(source);
    return source;
  });
  close = vi.fn(async () => undefined);

  constructor() {
    MockAudioContext.instances.push(this);
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  static instances: MockAudioWorkletNode[] = [];

  onprocessorerror: (() => void) | null = null;
  readonly port = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };

  constructor(
    readonly context: MockAudioContext,
    readonly processorName: string,
    readonly options?: AudioWorkletNodeOptions,
  ) {
    super();
    MockAudioWorkletNode.instances.push(this);
  }

  /** One decimated capture frame, the way the audio thread posts it. */
  emitFrame(samples: Int16Array): void {
    this.port.onmessage?.({
      data: samples.buffer,
    } as MessageEvent<ArrayBuffer>);
  }

  /** The worklet's answer to a flush request. */
  emitFlushed(): void {
    this.port.onmessage?.({
      data: { type: "flushed" },
    } as MessageEvent<unknown>);
  }
}

class MockMediaTrack {
  enabled = true;
  stop = vi.fn(() => undefined);
}

const createBootstrapMock = () =>
  vi.fn(
    async (
      _request: GeminiLiveTranscriptionSessionRequest,
    ): Promise<GeminiLiveTranscriptionBootstrap> => ({
      url: SOCKET_URL,
      token: TOKEN,
    }),
  );

const originalWebSocket = globalThis.WebSocket;
const originalAudioContext = globalThis.AudioContext;
const originalWorkletNode = globalThis.AudioWorkletNode;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let tracks: MockMediaTrack[] = [];
let mediaStream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let bootstrap: ReturnType<typeof createBootstrapMock>;
/** Swappable so a test can hold the worklet module load open. */
let addModule: (url: string) => Promise<void>;

// Enough microtask turns to fully drain the mocked start/stop promise chains.
const MICROTASK_TURNS = 50;
const flush = async () => {
  for (let index = 0; index < MICROTASK_TURNS; index += 1) {
    await Promise.resolve();
  }
};

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
  createGeminiLiveSTTTranscriber({ bootstrap });

const latestSocket = () => {
  const socket = MockWebSocket.instances.at(-1);
  expect(socket, "no websocket was constructed").toBeDefined();
  return socket!;
};

const latestContext = () => {
  const context = MockAudioContext.instances.at(-1);
  expect(context, "no capture audio context was created").toBeDefined();
  return context!;
};

const latestWorklet = () => {
  const worklet = MockAudioWorkletNode.instances.at(-1);
  expect(worklet, "no capture worklet node was created").toBeDefined();
  return worklet!;
};

const sentFrames = (socket: MockWebSocket = latestSocket()) =>
  socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);

interface PcmChunk {
  data: string;
  mimeType: string;
}

const audioOf = (frame: Record<string, unknown>): PcmChunk | undefined =>
  (frame.realtimeInput as { audio?: PcmChunk } | undefined)?.audio;

const activityStartIndex = (frames: Record<string, unknown>[]) =>
  frames.findIndex((frame) =>
    Boolean(
      (frame.realtimeInput as { activityStart?: unknown } | undefined)
        ?.activityStart,
    ),
  );

const activityEndOf = (frame: Record<string, unknown>) =>
  (frame.realtimeInput as { activityEnd?: unknown } | undefined)?.activityEnd;

const activityEndIndex = (frames: Record<string, unknown>[]) =>
  frames.findIndex((frame) => Boolean(activityEndOf(frame)));

/** The inverse of the client's base64 encoder, byte for byte. */
const decodeBase64 = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** Where these exact PCM samples went out on the wire, or -1. */
const audioFrameIndex = (
  frames: Record<string, unknown>[],
  samples: Int16Array,
) => {
  const expected = new Uint8Array(samples.buffer).toString();
  return frames.findIndex(
    (frame) => decodeBase64(audioOf(frame)?.data ?? "").toString() === expected,
  );
};

const deliverSetupComplete = (socket: MockWebSocket = latestSocket()) => {
  socket.deliver(JSON.stringify({ setupComplete: {} }));
};

const interimFrame = (text: unknown) =>
  JSON.stringify({ serverContent: { interimInputTranscription: { text } } });

const finalFrame = (text: unknown) =>
  JSON.stringify({ serverContent: { inputTranscription: { text } } });

/**
 * A real `Blob` whose `text()` stays pending until released, so the
 * string-overtakes-Blob interleave is forced by construction rather than by
 * timing.
 */
const deferredBlob = (payload: string) => {
  let release!: () => void;
  const text = new Promise<string>((resolve) => {
    release = () => resolve(payload);
  });
  const blob = new Blob([payload]);
  Object.defineProperty(blob, "text", { value: () => text });
  return { blob, release };
};

/** Deliver frames the way a burst arrives, then let the pump drain them. */
const deliverFrames = async (...payloads: unknown[]) => {
  for (const payload of payloads) {
    latestSocket().deliver(payload);
  }
  await flush();
};

const partialsOf = (transcriber: STTTranscriber) => {
  const partials: string[] = [];
  transcriber.onPartial?.((transcription) => partials.push(transcription));
  return partials;
};

/** Hold the worklet module load open until the returned resolver is called. */
const deferAddModule = () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  addModule = () => pending;
  return { release };
};

const startAndOpen = async (
  transcriber: STTTranscriber,
  options?: STTOptions,
) => {
  const started = transcriber.startRecording(options);
  await flush();
  latestSocket().open();
  deliverSetupComplete();
  await flush();
  await started;
};

/**
 * Ask for the stop and let the flush request reach the worklet, but leave it
 * unanswered: the acknowledgement is the caller's to send, because the
 * remainder frame and the stop-is-still-pending assertions both belong between
 * the request and the answer. Every ordering here is forced by construction —
 * `ack()` is what moves the handshake on, never elapsed time.
 */
const stopAndFlush = async (transcriber: STTTranscriber) => {
  const stopped = transcriber.stopRecording();
  const settlement = trackSettlement(stopped);
  await flush();
  return {
    stopped,
    settlement,
    /** The worklet's answer, optionally preceded by the remainder it drained. */
    ack: async (remainder?: Int16Array) => {
      if (remainder) {
        latestWorklet().emitFrame(remainder);
      }
      latestWorklet().emitFlushed();
      await flush();
    },
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  MockWebSocket.instances = [];
  MockAudioContext.instances = [];
  MockAudioWorkletNode.instances = [];
  addModule = async () => undefined;
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

  Object.defineProperty(globalThis, "WebSocket", {
    value: MockWebSocket,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: MockAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    value: MockAudioWorkletNode,
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:capture-worklet");
  URL.revokeObjectURL = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    value: originalWebSocket,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    value: originalWorkletNode,
    configurable: true,
  });
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GeminiLiveSTTTranscriber", () => {
  it("bootstraps the session, declares manual VAD, and opens the activity itself", async () => {
    const transcriber = createTranscriber();

    await startAndOpen(transcriber, { language: "ko" });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(bootstrap).toHaveBeenCalledWith({
      session: { model: "gemini-3.5-transcribe-live", language: "ko" },
    });
    expect(latestSocket().url).toBe(
      `${SOCKET_URL}?access_token=${ENCODED_TOKEN}`,
    );
    // The token's `bidiGenerateContentSetup` replaces this frame, but the
    // server sends no `setupComplete` until the client sends one (measured).
    expect(sentFrames()[0]).toEqual({
      setup: {
        model: "models/gemini-3.5-transcribe-live",
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { mode: "VERBATIM" },
        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
      },
    });
    expect(sentFrames()[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(transcriber.isRecording()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("builds the capture pipeline only after the activity is open, and stays connecting until it is up", async () => {
    const pendingModule = deferAddModule();
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);
    await flush();

    latestSocket().open();
    await flush();

    // Nothing is captured while the session is still unacknowledged.
    expect(sentFrames()).toHaveLength(1);
    expect(MockAudioContext.instances).toHaveLength(0);

    deliverSetupComplete();
    await flush();

    expect(sentFrames()[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(MockAudioContext.instances).toHaveLength(1);
    expect(latestContext().audioWorklet.addModule).toHaveBeenCalledTimes(1);
    // The pipeline is not up yet, so the start is not done either.
    expect(state.outcome).toBeNull();

    pendingModule.release();
    await started;

    expect(transcriber.isRecording()).toBe(true);
    expect(MockAudioContext.instances).toHaveLength(1);
  });

  it("rejects with CharivoTimeoutError when the bootstrap never resolves", async () => {
    bootstrap.mockImplementation(
      () => new Promise<GeminiLiveTranscriptionBootstrap>(() => {}),
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
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a bootstrap that omits the websocket url or token", async () => {
    for (const value of [
      {},
      { url: SOCKET_URL },
      { token: TOKEN },
      { url: "", token: TOKEN },
      { url: SOCKET_URL, token: 42 },
    ]) {
      bootstrap.mockResolvedValue(
        value as unknown as GeminiLiveTranscriptionBootstrap,
      );

      const transcriber = createTranscriber();
      await expectRejectsWith(
        transcriber.startRecording(),
        CharivoProviderError,
        "streaming STT bootstrap is missing its websocket url or token",
      );
      expect(MockWebSocket.instances).toHaveLength(0);
      expect(transcriber.isRecording()).toBe(false);
    }
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(5);
  });

  it("rejects and releases the microphone when the bootstrap fails", async () => {
    const failure = new Error("bootstrap rejected");
    bootstrap.mockRejectedValue(failure);

    const transcriber = createTranscriber();

    await expect(transcriber.startRecording()).rejects.toBe(failure);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CharivoTimeoutError when setupComplete never arrives", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoTimeoutError,
      "streaming STT session setup did not complete within 10000ms",
    );
    await flush();
    latestSocket().open();

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(MockAudioContext.instances).toHaveLength(0);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestSocket().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start when the server closes the socket before setupComplete, without leaking the token", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);
    await flush();

    latestSocket().open();
    latestSocket().serverClose(1007, "bad frame");

    // Settles without advancing to OPEN_TIMEOUT_MS.
    await expect(started).rejects.toBeInstanceOf(CharivoProviderError);
    await expect(started).rejects.toThrow("code 1007");
    const message = ((state.outcome?.value as Error) ?? new Error("")).message;
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(ENCODED_TOKEN);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("scrubs the token from a websocket the browser refuses to construct", async () => {
    // The built URL is a credential, and the native constructor error quotes
    // it. This is the one path where that string could reach app code.
    Object.defineProperty(globalThis, "WebSocket", {
      value: class {
        constructor(url: string) {
          throw new Error(`Failed to construct 'WebSocket': ${url} is invalid`);
        }
      },
      configurable: true,
    });

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);

    await expectRejectsWith(
      started,
      CharivoProviderError,
      "failed to open the Gemini Live websocket",
    );
    const message = ((state.outcome?.value as Error) ?? new Error("")).message;
    expect(message, "the raw token reached app code").not.toContain(TOKEN);
    expect(message, "the encoded token reached app code").not.toContain(
      ENCODED_TOKEN,
    );
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start when the socket errors before setupComplete", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoProviderError,
      "Gemini Live websocket error",
    );
    await flush();

    latestSocket().open();
    latestSocket().emitError();

    // Settles without advancing to OPEN_TIMEOUT_MS.
    await rejection;
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start when a frame arriving before setupComplete cannot be read", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoProviderError,
      "malformed Gemini Live message",
    );
    await flush();

    latestSocket().open();
    latestSocket().deliver("not json at all");

    await rejection;
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the pending start when stop is called while connecting, then starts a fresh session", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    await flush();
    const canceledSocket = latestSocket();

    // Nothing was transcribed yet, so canceling a connecting session is a
    // successful stop that resolves "" — not a thrown error.
    await expect(transcriber.stopRecording()).resolves.toBe("");
    await expect(started).rejects.toBeInstanceOf(CharivoStateError);
    expect(canceledSocket.close).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await startAndOpen(transcriber);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(sentFrames()[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(transcriber.isRecording()).toBe(true);
  });

  it("releases a microphone that resolves after the start was canceled", async () => {
    let resolveGetUserMedia!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        }),
    );

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    await flush();

    await expect(transcriber.stopRecording()).resolves.toBe("");
    await expect(started).rejects.toBeInstanceOf(CharivoStateError);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(tracks[0]!.stop).not.toHaveBeenCalled();

    // The permission prompt resolves after cancellation; its stream is stale
    // and must be released instead of leaking a hot mic.
    resolveGetUserMedia(mediaStream);
    await flush();

    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a capture pipeline that finishes building after the start was canceled", async () => {
    const pendingModule = deferAddModule();
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    await flush();
    latestSocket().open();
    deliverSetupComplete();
    await flush();

    // The pipeline build is in flight when the cancellation lands.
    expect(MockAudioContext.instances).toHaveLength(1);
    await expect(transcriber.stopRecording()).resolves.toBe("");
    await expect(started).rejects.toBeInstanceOf(CharivoStateError);

    pendingModule.release();
    await flush();

    const context = latestContext();
    const worklet = latestWorklet();
    expect(worklet.port.close).toHaveBeenCalledTimes(1);
    expect(worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(context.streamSources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start when the socket closes while the capture pipeline is still building", async () => {
    const pendingModule = deferAddModule();
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expectRejectsWith(
      started,
      CharivoProviderError,
      "Gemini Live websocket closed (code 1006)",
    );
    await flush();
    latestSocket().open();
    deliverSetupComplete();
    await flush();

    // The setup gate is already settled, so this close lands in the window the
    // `onError` routing comment describes: the session is still connecting, and
    // failing it terminally would let the start walk over the error and go live
    // on a pipeline the socket can no longer carry.
    expect(MockAudioContext.instances).toHaveLength(1);
    latestSocket().serverClose(1006);
    await flush();

    pendingModule.release();
    await flush();

    await rejection;
    // The pipeline finished building into a session that is already gone, so
    // the late-release guard owns its teardown.
    const context = latestContext();
    const worklet = latestWorklet();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(worklet.port.close).toHaveBeenCalledTimes(1);
    expect(worklet.disconnect).toHaveBeenCalledTimes(1);
    expect(context.streamSources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the start and closes the audio context when the worklet module fails to load", async () => {
    const failure = new Error("worklet module blocked");
    addModule = () => Promise.reject(failure);

    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const rejection = expect(started).rejects.toBe(failure);
    await flush();
    latestSocket().open();
    deliverSetupComplete();
    await flush();

    await rejection;
    // Until createCapturePipeline() returns, nothing else holds a reference
    // that could close this context, and browsers cap how many a page may keep
    // open while the caller retries.
    expect(
      latestContext().close,
      "the failed build left its audio context open",
    ).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(latestSocket().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("streams every capture frame as base64 PCM inside the open activity", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    // Both ends of the 16-bit range plus an asymmetric value: only a faithful
    // little-endian round trip reproduces these bytes.
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 4660]);
    latestWorklet().emitFrame(samples);
    latestWorklet().emitFrame(Int16Array.from([2, 3]));

    const frames = sentFrames();
    const audioIndexes = frames.flatMap((frame, index) =>
      audioOf(frame) ? [index] : [],
    );
    expect(audioIndexes, "no realtimeInput.audio frame was sent").toHaveLength(
      2,
    );
    const first = audioOf(frames[audioIndexes[0]!]!)!;
    expect(first.mimeType).toBe("audio/pcm;rate=16000");
    expect(decodeBase64(first.data)).toEqual(new Uint8Array(samples.buffer));
    const startIndex = activityStartIndex(frames);
    expect(startIndex, "the activity was never opened").toBeGreaterThan(-1);
    expect(
      Math.min(...audioIndexes),
      "audio was sent before the activity was opened",
    ).toBeGreaterThan(startIndex);
  });

  it("fails the recording when the capture worklet stops processing", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    // The only notice a dead worklet gives. Without it the session stays
    // connected and healthy-looking while the model hears nothing.
    latestWorklet().onprocessorerror?.();
    await flush();

    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoProviderError,
      "capture worklet stopped processing",
    );
    expect(transcriber.isRecording()).toBe(false);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits every cumulative interim exactly as the server sent it, unjoined and untrimmed", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    await deliverFrames(
      // Each interim is the whole recording so far, never a delta and never
      // reset across a pause — the measurement `handleServerMessage` records —
      // so a client that joined them would report "Please sayPlease say hi".
      interimFrame("Please say"),
      interimFrame("Please say hi"),
      interimFrame("Please say hi and smile for me."),
      // Nothing normalizes the text on the way out: partials are exactly what
      // the server sent, and the trim belongs to the transcript stop resolves.
      interimFrame("  Please say hi and smile for me.  "),
    );

    expect(partials, "the interims were joined, trimmed, or dropped").toEqual([
      "Please say",
      "Please say hi",
      "Please say hi and smile for me.",
      "  Please say hi and smile for me.  ",
    ]);
    expect(transcriber.isRecording()).toBe(true);
  });

  it("emits nothing when the server repeats an interim unchanged", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    await deliverFrames(
      interimFrame("Please say hi"),
      // The measured cost of manual VAD: the interim repeats while the speaker
      // is silent (8 identical frames across a 1.5 s gap).
      interimFrame("Please say hi"),
      interimFrame("Please say hi"),
      interimFrame("Please say hi and smile for me."),
      interimFrame("Please say hi and smile for me."),
    );

    expect(partials, "a repeated interim was emitted again").toEqual([
      "Please say hi",
      "Please say hi and smile for me.",
    ]);
  });

  it("emits an interim shorter than its predecessor as given", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    // A revising hypothesis is unmeasured but not ruled out. Suppressing one
    // would leave subscribers holding text the transcript no longer contains,
    // so it is emitted as given and the demo's replace-the-draft handler
    // absorbs it.
    await deliverFrames(
      interimFrame("I scream for ice cream"),
      interimFrame("ice cream"),
    );

    expect(partials, "a shorter interim was suppressed").toEqual([
      "I scream for ice cream",
      "ice cream",
    ]);
  });

  it("lets a pre-stop final replace the snapshot and emits it under the same dedupe rule", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    await deliverFrames(
      interimFrame("Please say"),
      // Not expected under manual VAD; if one arrives it is a snapshot like
      // any other, not the answer to a stop.
      finalFrame("Please say hi."),
      // Already emitted by the final: the dedupe is keyed on what subscribers
      // last saw, not on which field it came from.
      interimFrame("Please say hi."),
      // Emitted again because the final REPLACED the snapshot; appending would
      // have made the final read "Please sayPlease say hi.".
      interimFrame("Please say"),
    );

    expect(partials).toEqual(["Please say", "Please say hi.", "Please say"]);
    expect(
      transcriber.isRecording(),
      "a pre-stop final ended the recording",
    ).toBe(true);
  });

  it("applies a Blob frame before a string frame that arrives while it is still being read", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    const held = deferredBlob(interimFrame("Please say"));
    latestSocket().deliver(held.blob);
    latestSocket().deliver(interimFrame("Please say hi"));
    await flush();

    expect(
      partials,
      "a string frame overtook a Blob still inside text()",
    ).toEqual([]);

    held.release();
    await flush();

    expect(partials, "the frames were applied out of order").toEqual([
      "Please say",
      "Please say hi",
    ]);
  });

  it("abandons a torn-down session's pending Blob instead of queueing it ahead of the next session", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    const stale = deferredBlob(interimFrame("ghost"));
    latestSocket().deliver(stale.blob);
    await flush();

    // Tears the session down with that frame still inside text().
    window.dispatchEvent(new Event("pagehide"));
    expect(transcriber.isRecording()).toBe(false);

    // Hangs here if the next session's setupComplete queues behind the stale
    // session's pump.
    await startAndOpen(transcriber);
    expect(transcriber.isRecording()).toBe(true);

    stale.release();
    await deliverFrames(interimFrame("Please say"));

    expect(
      partials,
      "a torn-down session's frame reached the next session",
    ).toEqual(["Please say"]);
  });

  it("fails the recording on a frame it cannot read and surfaces it on the next stop exactly once", async () => {
    // Not JSON at all, then JSON that is not an object — including the `null`
    // that `typeof` calls an object.
    for (const payload of ["not json at all", "42", "null"]) {
      const transcriber = createTranscriber();
      await startAndOpen(transcriber);

      await deliverFrames(payload);

      await expectRejectsWith(
        transcriber.stopRecording(),
        CharivoProviderError,
        "malformed Gemini Live message",
      );
      // Reported once: the stop that surfaced it also cleared it, so a second
      // stop is the clean no-op every idempotent teardown expects.
      await expect(transcriber.stopRecording()).resolves.toBe("");
      expect(transcriber.isRecording()).toBe(false);
    }
  });

  it("fails the recording when a transcription field carries a non-string text", async () => {
    for (const frame of [
      interimFrame(42),
      interimFrame(null),
      finalFrame(42),
      finalFrame(null),
    ]) {
      const transcriber = createTranscriber();
      const partials = partialsOf(transcriber);
      await startAndOpen(transcriber);

      await deliverFrames(frame);

      await expectRejectsWith(
        transcriber.stopRecording(),
        CharivoProviderError,
        "malformed Gemini Live message",
      );
      expect(partials, "an unreadable transcript was emitted").toEqual([]);
      expect(transcriber.isRecording()).toBe(false);
    }
  });

  it("reads an interim that omits its text as the empty transcript it is", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    // An absent `text` is the proto3 default, not a broken frame: this API
    // serializes a message whose only field holds its default as `{}`, which is
    // exactly how the measured `setupComplete: {}` and `serverContent: {}`
    // arrive. Decoded as "", it is the snapshot the session already holds, so
    // it is a dedupe no-op rather than a failed session.
    await deliverFrames(
      JSON.stringify({ serverContent: { interimInputTranscription: {} } }),
      interimFrame("Please say hi"),
    );

    expect(partials, "an omitted interim text was emitted").toEqual([
      "Please say hi",
    ]);
    expect(
      transcriber.isRecording(),
      "an omitted interim text ended the recording",
    ).toBe(true);
  });

  it("ignores the frame kinds it does not read, without touching the snapshot", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    await deliverFrames(interimFrame("Please say hi"));
    await deliverFrames(
      // Measured shape: `voiceActivity` is top-level beside an empty
      // `serverContent`. It and `generationComplete` decide nothing here,
      // because the client declares the only activity boundary.
      JSON.stringify({
        serverContent: {},
        voiceActivity: { type: "ACTIVITY_END", audioOffset: "3.600s" },
      }),
      JSON.stringify({ serverContent: { generationComplete: true } }),
      // A resumption handle is a session credential, and the mint's `uses: 1`
      // forces a re-mint anyway.
      JSON.stringify({
        sessionResumptionUpdate: { newHandle: "handle", resumable: true },
      }),
      JSON.stringify({ goAway: { timeLeft: "10s" } }),
      JSON.stringify({ usageMetadata: { totalTokenCount: 42 } }),
    );

    expect(partials, "an unread frame kind produced a partial").toEqual([
      "Please say hi",
    ]);
    expect(
      transcriber.isRecording(),
      "an unread frame kind ended the recording",
    ).toBe(true);

    // The snapshot survived them, so the repeat is still a duplicate.
    await deliverFrames(interimFrame("Please say hi"));

    expect(partials, "an unread frame kind reset the snapshot").toEqual([
      "Please say hi",
    ]);
  });

  it("rejects a reentrant start without opening a second socket", async () => {
    const transcriber = createTranscriber();
    const started = transcriber.startRecording();
    const state = trackSettlement(started);

    await expectRejectsWith(
      transcriber.startRecording(),
      CharivoStateError,
      "already recording",
    );
    expect(state.outcome).toBeNull();

    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    latestSocket().open();
    deliverSetupComplete();
    await flush();
    await started;

    await expectRejectsWith(
      transcriber.startRecording(),
      CharivoStateError,
      "already recording",
    );
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("resolves an empty transcript after the flush ack when no audio was ever sent", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);

    const stop = await stopAndFlush(transcriber);

    // The tail of the recording is still on the audio thread until the worklet
    // answers, so nothing can settle before it does.
    expect(
      stop.settlement.outcome,
      "the stop settled before the flush was acknowledged",
    ).toBeNull();

    await stop.ack();

    expect(stop.settlement.outcome).toEqual({ status: "resolved", value: "" });
    // No audio ever went out, so there is no turn to close and no final to
    // wait for.
    expect(
      activityEndIndex(sentFrames()),
      "an empty recording still closed an activity",
    ).toBe(-1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends the flushed remainder before the single activityEnd and resolves the first final after it", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);

    latestWorklet().emitFrame(Int16Array.from([1, 2]));
    await deliverFrames(interimFrame("and smile"));

    const stop = await stopAndFlush(transcriber);
    // What the audio thread had buffered below one frame: the end of what the
    // user said, and the server can only place it inside the open activity.
    const remainder = Int16Array.from([9, -9]);
    await stop.ack(remainder);

    const frames = sentFrames();
    const endIndex = activityEndIndex(frames);
    expect(endIndex, "the activity was never closed").toBeGreaterThan(-1);
    expect(
      frames.filter((frame) => activityEndOf(frame)),
      "the activity was closed more than once",
    ).toHaveLength(1);
    const remainderIndex = audioFrameIndex(frames, remainder);
    expect(
      remainderIndex,
      "the flushed remainder never reached the socket",
    ).toBeGreaterThan(-1);
    expect(
      remainderIndex,
      "the remainder was sent after the activity closed",
    ).toBeLessThan(endIndex);

    // An interim after activityEnd is still a draft; only a final answers.
    await deliverFrames(interimFrame("and smile for"));
    expect(stop.settlement.outcome, "an interim satisfied the stop").toBeNull();

    await deliverFrames(finalFrame("  and smile for me.  "));

    await expect(stop.stopped).resolves.toBe("and smile for me.");
    // The partial is what the server sent; only the transcript stop returns is
    // trimmed.
    expect(partials).toEqual([
      "and smile",
      "and smile for",
      "  and smile for me.  ",
    ]);
  });

  it("leaves the last partial equal to the untrimmed form of what stop resolves, whether or not the final revises it", async () => {
    // The convergence property the live harness asserts, which it compares
    // trimmed on both sides. These finals need no trimming, so the two agree
    // exactly; the trim that separates them otherwise is pinned by the
    // "  and smile for me.  " case above.
    for (const [final, expected] of [
      ["and smile for me.", ["and smile for me."]],
      ["and smile for me!", ["and smile for me.", "and smile for me!"]],
    ] as const) {
      const transcriber = createTranscriber();
      const partials = partialsOf(transcriber);
      await startAndOpen(transcriber);
      latestWorklet().emitFrame(Int16Array.from([1]));
      await deliverFrames(interimFrame("and smile for me."));

      const stop = await stopAndFlush(transcriber);
      await stop.ack();
      await deliverFrames(finalFrame(final));

      const resolved = await stop.stopped;
      expect(resolved).toBe(final);
      expect(
        partials,
        "a final that repeated its last interim was emitted again",
      ).toEqual(expected);
      expect(partials.at(-1)).toBe(resolved);
    }
  });

  it("closes the activity anyway when a final arrived before the stop, and waits for the next one", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    // Not expected under manual VAD, and it arrived before `activityEnd`, so
    // it settles nothing — the rule `maybeResolveStop` records.
    await deliverFrames(finalFrame("Please say hi."));

    const stop = await stopAndFlush(transcriber);
    await stop.ack();

    expect(
      activityEndIndex(sentFrames()),
      "a pre-stop final was treated as the answer",
    ).toBeGreaterThan(-1);
    expect(
      stop.settlement.outcome,
      "a pre-stop final satisfied the stop",
    ).toBeNull();

    await deliverFrames(finalFrame("Please say hi and smile."));

    await expect(stop.stopped).resolves.toBe("Please say hi and smile.");
  });

  it("decides a final's eligibility when it arrived, not when it is applied", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    // Arrives before the stop and is still inside text() when the activity
    // closes. The pump is asynchronous between arrival and handling, so a
    // client that read `activityEnded` while APPLYING this would answer the
    // stop with a transcript missing everything said after this frame.
    const held = deferredBlob(finalFrame("Please say hi."));
    latestSocket().deliver(held.blob);
    await flush();

    const stop = await stopAndFlush(transcriber);
    await stop.ack();

    expect(
      activityEndIndex(sentFrames()),
      "the activity closed before the held frame was read",
    ).toBeGreaterThan(-1);

    held.release();
    await flush();

    // Applied as a snapshot like any other final, and emitted — but being
    // emitted is not being eligible.
    expect(partials, "the pre-stop final never reached subscribers").toEqual([
      "Please say hi.",
    ]);
    expect(
      stop.settlement.outcome,
      "a final that arrived before activityEnd answered the stop",
    ).toBeNull();

    // The one that did arrive after activityEnd, carrying the tail the held
    // frame could not have covered.
    await deliverFrames(finalFrame("Please say hi and smile for me."));

    await expect(stop.stopped).resolves.toBe("Please say hi and smile for me.");

    // The mirror: arrival is what decides, so a Blob that arrived AFTER
    // activityEnd answers the stop however late its text() resolves.
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const second = await stopAndFlush(transcriber);
    await second.ack();

    const late = deferredBlob(finalFrame("and smile for me."));
    latestSocket().deliver(late.blob);
    await flush();

    expect(
      second.settlement.outcome,
      "the stop settled before the final was readable",
    ).toBeNull();

    late.release();
    await flush();

    await expect(second.stopped).resolves.toBe("and smile for me.");
  });

  it("resolves an empty transcript when the final after activityEnd carries no text", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    await stop.ack();
    expect(
      stop.settlement.outcome,
      "the stop settled before any final arrived",
    ).toBeNull();

    await deliverFrames(finalFrame(""));

    await expect(stop.stopped).resolves.toBe("");
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves an empty transcript when the final after activityEnd omits its text", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    await stop.ack();

    // The same proto3 default the interim gets, on the field that answers the
    // stop: a transcript of nothing is a transcript, not a malformed frame.
    await deliverFrames(
      JSON.stringify({ serverContent: { inputTranscription: {} } }),
    );

    await expect(stop.stopped).resolves.toBe("");
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with CharivoTimeoutError when no final arrives within the stop deadline", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    const rejection = expectRejectsWith(
      stop.stopped,
      CharivoTimeoutError,
      "stop timed out after 5000ms waiting for the final transcript",
    );
    await stop.ack();
    await deliverFrames(interimFrame("and smile for"));

    await vi.advanceTimersByTimeAsync(5_000);

    // The deadline is a failure, never a truncated success: a transcript that
    // silently loses its tail is worse than a visible error.
    await rejection;
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the stop when the socket closes before the flush is acknowledged, and sends nothing when the ack lands later", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    const rejection = expectRejectsWith(
      stop.stopped,
      CharivoProviderError,
      "Gemini Live websocket closed (code 1006)",
    );
    const socket = latestSocket();
    socket.serverClose(1006);

    await rejection;

    // The worklet's answer arrives after the session is gone; it must not
    // resurrect the handshake.
    const sentBeforeAck = socket.sent.length;
    latestWorklet().emitFlushed();
    await vi.advanceTimersByTimeAsync(250);
    await flush();

    expect(socket.sent).toHaveLength(sentBeforeAck);
    expect(
      activityEndIndex(sentFrames()),
      "a torn-down session still closed its activity",
    ).toBe(-1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the stop when the capture worklet never acknowledges the flush", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    const rejection = expectRejectsWith(
      stop.stopped,
      CharivoProviderError,
      "capture worklet did not drain before stop",
    );

    await vi.advanceTimersByTimeAsync(250);

    // The tail of the recording is gone. Failing the stop is the only honest
    // outcome; transcribing what did arrive would hide the loss.
    await rejection;
    expect(
      activityEndIndex(sentFrames()),
      "an undrained recording still closed its activity",
    ).toBe(-1);
    expect(latestSocket().close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the stop instead of hanging when the activityEnd cannot be sent", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    // The flush drained, so the tail is on the wire; only the frame that closes
    // the turn is left, and the socket refuses it.
    const sendFailure = new Error("socket is closed");
    latestSocket().send.mockImplementation(() => {
      throw sendFailure;
    });

    await stop.ack();

    // Nothing will ever answer a turn that was never closed, so the stop has to
    // fail now rather than wait out its deadline.
    await expect(stop.stopped).rejects.toBe(sendFailure);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends no audio after the activity was closed", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);
    await stop.ack();

    // What this pins is the wire order — nothing follows `activityEnd` — and
    // not the client's `activityEnded` guard, which this frame never reaches:
    // finalizeStop() stopped the pipeline before closing the activity, and that
    // nulls `port.onmessage`, so the emit below is the no-op a real audio
    // thread's late frame also is. The guard is defensive for the reason
    // `sendAudioFrame` records; deleting it would leave this test green.
    const late = Int16Array.from([7, 7]);
    latestWorklet().emitFrame(late);
    await flush();

    const frames = sentFrames();
    const endIndex = activityEndIndex(frames);
    expect(endIndex, "the activity was never closed").toBeGreaterThan(-1);
    expect(
      audioFrameIndex(frames, late),
      "audio was sent after the activity closed",
    ).toBe(-1);

    await deliverFrames(finalFrame("and smile."));
    await expect(stop.stopped).resolves.toBe("and smile.");
  });

  it("stops the capture pipeline exactly once, whether the stop resolves or fails", async () => {
    const settleWithFinal = async (
      stop: Awaited<ReturnType<typeof stopAndFlush>>,
    ) => {
      await deliverFrames(finalFrame("and smile."));
      await stop.stopped;
    };
    const settleWithDeadline = async (
      stop: Awaited<ReturnType<typeof stopAndFlush>>,
    ) => {
      const rejection = expectRejectsWith(
        stop.stopped,
        CharivoTimeoutError,
        "stop timed out after 5000ms waiting for the final transcript",
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
    };

    for (const settle of [settleWithFinal, settleWithDeadline]) {
      const transcriber = createTranscriber();
      await startAndOpen(transcriber);
      latestWorklet().emitFrame(Int16Array.from([1]));
      const context = latestContext();
      const worklet = latestWorklet();

      const stop = await stopAndFlush(transcriber);
      await stop.ack();
      await settle(stop);

      // The stop path hands the pipeline out of the field before stopping it,
      // so the cleanup that follows cannot close the same audio graph again.
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(worklet.port.close).toHaveBeenCalledTimes(1);
      expect(worklet.disconnect).toHaveBeenCalledTimes(1);
      expect(context.streamSources[0]!.disconnect).toHaveBeenCalledTimes(1);
    }
  });

  it("surfaces a mid-recording socket close on the next stop exactly once, then starts a fresh session", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));
    await deliverFrames(interimFrame("and smile for"));

    latestSocket().serverClose(1006);
    await flush();

    // Nothing is banked mid-recording, so the utterance is lost rather than
    // returned half-transcribed — the same trade @charivo/stt/openai-realtime
    // makes with its single commit at stop.
    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoProviderError,
      "Gemini Live websocket closed (code 1006)",
    );
    // Reported once: the stop that surfaced it also cleared it.
    await expect(transcriber.stopRecording()).resolves.toBe("");
    expect(partials).toEqual(["and smile for"]);
    expect(transcriber.isRecording()).toBe(false);

    await startAndOpen(transcriber);

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(sentFrames()[1]).toEqual({ realtimeInput: { activityStart: {} } });
    expect(transcriber.isRecording()).toBe(true);
  });

  it("rejects a second stop while the first is still in flight", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const stop = await stopAndFlush(transcriber);

    await expectRejectsWith(
      transcriber.stopRecording(),
      CharivoStateError,
      "stop already in progress",
    );

    await stop.ack();
    await deliverFrames(finalFrame("and smile."));

    await expect(stop.stopped).resolves.toBe("and smile.");
    // One handshake, however many callers asked for it.
    expect(latestWorklet().port.postMessage).toHaveBeenCalledTimes(1);
    expect(sentFrames().filter((frame) => activityEndOf(frame))).toHaveLength(
      1,
    );
  });

  it("releases the socket, the capture graph, the microphone, and every timer on a normal stop", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));
    const socket = latestSocket();
    const context = latestContext();
    const worklet = latestWorklet();

    const stop = await stopAndFlush(transcriber);
    await stop.ack();
    await deliverFrames(finalFrame("and smile."));
    await stop.stopped;

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(worklet.port.close).toHaveBeenCalledTimes(1);
    // Nulled, not merely closed: a queued message resolves its handler at
    // dispatch time, so the attribute is what keeps a late frame out.
    expect(worklet.port.onmessage).toBeNull();
    expect(worklet.onprocessorerror).toBeNull();
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tears down on pagehide, rejecting a stop that was mid-flush, and stops listening afterwards", async () => {
    const transcriber = createTranscriber();
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));
    const socket = latestSocket();
    const context = latestContext();

    const stop = await stopAndFlush(transcriber);
    const rejection = expectRejectsWith(
      stop.stopped,
      CharivoStateError,
      "recording ended",
    );

    window.dispatchEvent(new Event("pagehide"));

    await rejection;
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(transcriber.isRecording()).toBe(false);

    // The listener went with the session, so a later pagehide reaches nothing.
    window.dispatchEvent(new Event("pagehide"));
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);

    // The flush left in flight settles on its own deadline and finds the
    // session already gone.
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(
      activityEndIndex(sentFrames()),
      "a torn-down session still closed its activity",
    ).toBe(-1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a stale socket's frames and close across two sequential sessions", async () => {
    const transcriber = createTranscriber();
    const partials = partialsOf(transcriber);
    await startAndOpen(transcriber);
    latestWorklet().emitFrame(Int16Array.from([1]));

    const staleSocket = latestSocket();
    const stop = await stopAndFlush(transcriber);
    await stop.ack();
    await deliverFrames(finalFrame("and smile."));
    await expect(stop.stopped).resolves.toBe("and smile.");

    await startAndOpen(transcriber);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Still attached to the closed socket, so its events belong to a
    // generation that is gone.
    staleSocket.deliver(interimFrame("ghost"));
    staleSocket.serverClose(1006);
    await flush();

    expect(partials, "a stale socket's frame reached the next session").toEqual(
      ["and smile."],
    );
    expect(
      transcriber.isRecording(),
      "a stale socket's close ended the next session",
    ).toBe(true);

    await deliverFrames(interimFrame("Please say"));

    expect(partials).toEqual(["and smile.", "Please say"]);
  });
});

describe("Gemini Live STT capture pipeline", () => {
  const buildPipeline = async () => {
    const frames: Uint8Array[] = [];
    const pipeline = await createCapturePipeline({
      stream: mediaStream,
      onFrame: (frame) => frames.push(frame),
      onError: vi.fn(),
    });
    return { pipeline, frames, worklet: latestWorklet() };
  };

  it("asks the worklet to flush and delivers the remainder it answers with", async () => {
    const { pipeline, frames, worklet } = await buildPipeline();

    const flushed = pipeline.flush();

    expect(
      worklet.port.postMessage,
      "the worklet was never asked to flush",
    ).toHaveBeenCalledWith({ type: "flush" });

    // What the audio thread had buffered below one frame — the tail of the
    // recording — followed by the acknowledgement.
    const remainder = Int16Array.from([9, -9]);
    worklet.emitFrame(remainder);
    worklet.emitFlushed();

    await expect(flushed).resolves.toEqual({ drained: true });
    expect(frames, "the remainder frame never reached onFrame").toEqual([
      new Uint8Array(remainder.buffer),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves an undrained flush rather than rejecting when the worklet never answers", async () => {
    const { pipeline } = await buildPipeline();

    const state = trackSettlement(pipeline.flush());

    await vi.advanceTimersByTimeAsync(249);
    expect(state.outcome, "the flush settled before its deadline").toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    // Resolved, never rejected: an undrained tail is the stop path's decision
    // to make, and a rejection racing the acknowledgement would hide it.
    expect(state.outcome).toEqual({
      status: "resolved",
      value: { drained: false },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Gemini Live STT capture worklet source", () => {
  interface WorkletPort {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage(message: unknown, transfer?: unknown[]): void;
  }
  interface CaptureProcessor {
    port: WorkletPort;
    process(inputs: Float32Array[][]): boolean;
  }
  type CaptureProcessorClass = new (options: {
    processorOptions: { targetRate: number; frameSamples: number };
  }) => CaptureProcessor;

  /**
   * Compile and run the worklet string against stub globals. Nothing else
   * executes it — the mock node in the suite above answers the consumer half of
   * this protocol with a hardcoded message, so the two halves would agree even
   * if both were wrong. No type checker reads a template literal either.
   */
  const loadWorklet = (frameSamples: number) => {
    const posted: unknown[] = [];
    class StubAudioWorkletProcessor {
      readonly port: WorkletPort = {
        onmessage: null,
        postMessage: (message: unknown) => {
          posted.push(message);
        },
      };
    }
    let Processor!: CaptureProcessorClass;
    const registerProcessor = (
      _name: string,
      processor: CaptureProcessorClass,
    ) => {
      Processor = processor;
    };

    const evaluate = new Function(
      "AudioWorkletProcessor",
      "registerProcessor",
      "sampleRate",
      CAPTURE_WORKLET_SOURCE,
    ) as (
      base: typeof StubAudioWorkletProcessor,
      register: typeof registerProcessor,
      rate: number,
    ) => void;
    // The device rate equals the target rate here, so one input sample
    // decimates to exactly one output sample and the frame math stays readable.
    evaluate(StubAudioWorkletProcessor, registerProcessor, 16000);

    const processor = new Processor({
      processorOptions: { targetRate: 16000, frameSamples },
    });
    return {
      posted,
      capture: (samples: number[]) => {
        processor.process([[Float32Array.from(samples)]]);
      },
      requestFlush: () => {
        processor.port.onmessage?.({ data: { type: "flush" } });
      },
    };
  };

  const asFrame = (message: unknown) =>
    message instanceof ArrayBuffer ? Array.from(new Int16Array(message)) : null;

  it("posts the samples buffered below one frame before it acknowledges a flush", () => {
    const worklet = loadWorklet(4);

    // Three samples against a four-sample frame: the end of what the user said,
    // and nothing in `process()` will ever post it.
    worklet.capture([1, -1, 0.5]);
    expect(
      worklet.posted,
      "a partial frame was posted before the flush asked for it",
    ).toEqual([]);

    worklet.requestFlush();

    // The remainder FIRST: the consumer stops waiting at the acknowledgement,
    // so a tail posted after it would arrive to a torn-down pipeline.
    expect(worklet.posted.map(asFrame)).toEqual([[32767, -32768, 16383], null]);
    expect(worklet.posted[1]).toEqual({ type: "flushed" });

    // The remainder left `pending`, so there is nothing to post twice.
    worklet.requestFlush();

    expect(worklet.posted.slice(2)).toEqual([{ type: "flushed" }]);
  });

  it("acknowledges a flush it has nothing buffered for", () => {
    const worklet = loadWorklet(4);

    worklet.requestFlush();

    // A recording that ended on a frame boundary still has to be answered, or
    // the stop that asked fails on its own deadline.
    expect(worklet.posted).toEqual([{ type: "flushed" }]);
  });

  it("posts every whole frame a single process() call fills, and buffers the rest", () => {
    const worklet = loadWorklet(4);

    // Nine samples against a four-sample frame: one render quantum can hold
    // more than one frame, so the emission has to loop rather than post once
    // and leave the surplus behind for the next call.
    worklet.capture([1, -1, 0.5, 0, 0.25, -0.25, 1, -1, 0.5]);

    expect(worklet.posted.map(asFrame)).toEqual([
      [32767, -32768, 16383, 0],
      [8191, -8192, 32767, -32768],
    ]);

    worklet.requestFlush();

    // The ninth sample stayed below the boundary, so it is still the tail only
    // the flush can reach.
    expect(worklet.posted.slice(2).map(asFrame)).toEqual([[16383], null]);
    expect(worklet.posted[3]).toEqual({ type: "flushed" });
  });
});
