import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TTSOptions, TTSPcmFormat, TTSPcmStream } from "@charivo/core";
import { createTTSManager } from "../src";

class MockAudio {
  static instances: MockAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  volume = 1;

  constructor(public readonly src: string) {
    MockAudio.instances.push(this);
  }

  play = vi.fn(async () => {
    queueMicrotask(() => {
      this.onended?.();
    });
  });

  pause = vi.fn(() => undefined);
}

class FakeAudioBuffer {
  readonly duration: number;
  private readonly channel: Float32Array;

  constructor(
    readonly length: number,
    sampleRate: number,
  ) {
    this.channel = new Float32Array(length);
    this.duration = length / sampleRate;
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn((_when?: number) => undefined);
  stop = vi.fn(() => undefined);

  /** The `ended` event the browser fires when this source finishes. */
  end(): void {
    const handler = this.onended;
    this.onended = null;
    handler?.();
  }
}

class FakeAnalyser {
  fftSize = 0;
  smoothingTimeConstant = 0;
  frequencyBinCount = 128; // fftSize 256, as in production
  connect = vi.fn();
  disconnect = vi.fn();
  getByteFrequencyData = vi.fn((target: Uint8Array) => {
    // One saturated bin inside the [12, 76) speech band, so an attached
    // analyzer reads above zero and a stopped one can be told apart.
    target.fill(0);
    target[40] = 255;
  });
}

/**
 * Stands in for both contexts a streamed utterance uses: the manager's own
 * playback context and the lip-sync analyzer's. jsdom ships no Web Audio API.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  state: AudioContextState = "running";
  destination = {};
  readonly buffers: FakeAudioBuffer[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly gains: Array<{
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
  }> = [];
  /** The graph's silent tap; lip sync is attached to this stream. */
  readonly tap = { stream: {} as MediaStream };

  createAnalyser = vi.fn(() => new FakeAnalyser() as unknown as AnalyserNode);
  createMediaStreamSource = vi.fn((_stream: MediaStream) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createMediaElementSource = vi.fn((_element: HTMLAudioElement) => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));
  createGain = vi.fn(() => {
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(gain);
    return gain;
  });
  createMediaStreamDestination = vi.fn(() => this.tap);
  createBuffer = vi.fn(
    (_channels: number, length: number, sampleRate: number) => {
      const buffer = new FakeAudioBuffer(length, sampleRate);
      this.buffers.push(buffer);
      return buffer;
    },
  );
  createBufferSource = vi.fn(() => {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  });
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

/**
 * Told apart by what each is asked to build, never by creation order: the two
 * are the same class with the same shape, so an order that changes -- once
 * prepareAudio() also warms the playback context, say -- would leave these
 * assertions green against the wrong context.
 */
function contextThatCalled(
  method: "createGain" | "createAnalyser",
): FakeAudioContext {
  const matches = FakeAudioContext.instances.filter(
    (instance) => instance[method].mock.calls.length > 0,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

/** Only the manager builds a gain node; only the analyzer builds an analyser. */
const playbackContext = (): FakeAudioContext => contextThatCalled("createGain");
const analyzerContext = (): FakeAudioContext =>
  contextThatCalled("createAnalyser");

interface ControllableStream {
  body: ReadableStream<Uint8Array>;
  push(bytes: Uint8Array): void;
  close(): void;
  error(reason: unknown): void;
  /** Records a cancel of the returned body, whoever asked for it. */
  cancel: ReturnType<typeof vi.fn>;
}

/** A response body the test feeds by hand, one chunk at a time. */
function createControllableStream(): ControllableStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn((_reason?: unknown) => undefined);

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel(reason) {
      cancel(reason);
    },
  });

  return {
    body,
    push: (bytes) => controller.enqueue(bytes),
    close: () => controller.close(),
    error: (reason) => controller.error(reason),
    cancel,
  };
}

/** Player that can do both; the manager must prefer the streaming method. */
class StreamingPlayer {
  playbackMode = "audio" as const;
  format: TTSPcmFormat = {
    encoding: "pcm-s16le",
    sampleRate: 24000,
    channels: 1,
  };
  /** One per generateAudioStream() call, newest last. */
  readonly streams: ControllableStream[] = [];
  /** The signals the manager handed over, so cancellation can be asserted. */
  readonly signals: Array<AbortSignal | undefined> = [];

  speak = vi.fn(async (_text: string, _options?: TTSOptions) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  generateAudio = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  generateAudioStream = vi.fn(
    async (
      _text: string,
      _options?: TTSOptions,
      signal?: AbortSignal,
    ): Promise<TTSPcmStream> => {
      this.signals.push(signal);
      const stream = createControllableStream();
      this.streams.push(stream);
      return { body: stream.body, format: this.format };
    },
  );

  /** The stream of the most recent call. */
  get stream(): ControllableStream {
    return this.streams[this.streams.length - 1]!;
  }
}

/** Player without the streaming method: stays on the blob/<audio> path. */
class BufferedPlayer {
  playbackMode = "audio" as const;
  audioMimeType = "audio/wav";
  speak = vi.fn(async (_text: string, _options?: TTSOptions) => undefined);
  stop = vi.fn(async () => undefined);
  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  generateAudio = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
}

/**
 * Yields a full task turn (a setTimeout hop, not a microtask), so the pump's
 * chained reads settle before the assertion runs.
 */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Observes a promise's settlement without making the test wait for it. */
function track(promise: Promise<void>): {
  promise: Promise<void>;
  state: "pending" | "resolved" | "rejected";
} {
  const tracked = { promise, state: "pending" as const } as {
    promise: Promise<void>;
    state: "pending" | "resolved" | "rejected";
  };
  promise.then(
    () => {
      tracked.state = "resolved";
    },
    () => {
      tracked.state = "rejected";
    },
  );
  return tracked;
}

/** `sampleCount` samples of silence, the shape a real chunk arrives in. */
const silence = (sampleCount: number): Uint8Array =>
  new Uint8Array(sampleCount * 2);

const countEvents = (
  emitter: { emit: ReturnType<typeof vi.fn> },
  name: string,
): number =>
  emitter.emit.mock.calls.filter(([eventName]) => eventName === name).length;

const originalAudio = globalThis.Audio;
const originalAudioContext = window.AudioContext;

function installAudioMocks(): void {
  MockAudio.instances = [];
  FakeAudioContext.instances = [];
  globalThis.Audio = MockAudio as unknown as typeof Audio;
  Object.defineProperty(window, "AudioContext", {
    value: FakeAudioContext,
    configurable: true,
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

function restoreAudioMocks(): void {
  globalThis.Audio = originalAudio;
  Object.defineProperty(window, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  vi.restoreAllMocks();
}

describe("TTSManagerImpl streamed playback", () => {
  // Managers subscribe to browser lifecycle events; track them so afterEach
  // can dispose them instead of letting the subscriptions accumulate.
  let createdManagers: ReturnType<typeof createTTSManager>[] = [];
  const trackManager = (
    player: Parameters<typeof createTTSManager>[0],
  ): ReturnType<typeof createTTSManager> => {
    const manager = createTTSManager(player);
    createdManagers.push(manager);
    return manager;
  };

  beforeEach(() => {
    installAudioMocks();
    createdManagers = [];
  });

  afterEach(async () => {
    await Promise.all(createdManagers.map((manager) => manager.dispose()));
    restoreAudioMocks();
  });

  it("sends a streaming player to generateAudioStream, never generateAudio", async () => {
    const player = new StreamingPlayer();
    const manager = trackManager(player);

    const speaking = track(manager.speak("hello"));
    await nextTask();

    expect(player.generateAudioStream).toHaveBeenCalledTimes(1);
    expect(player.generateAudioStream).toHaveBeenCalledWith(
      "hello",
      undefined,
      expect.any(AbortSignal),
    );
    expect(player.generateAudio).not.toHaveBeenCalled();
    expect(MockAudio.instances).toHaveLength(0);

    player.stream.close();
    await speaking.promise;
  });

  it("keeps a buffered player on the blob playback path", async () => {
    const player = new BufferedPlayer();
    const manager = trackManager(player);

    await manager.speak("hello");

    expect(player.generateAudio).toHaveBeenCalledTimes(1);
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledTimes(1);
  });

  it("emits tts:audio:start once, only when the first sample is scheduled", async () => {
    const player = new StreamingPlayer();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter(emitter);

    const speaking = track(manager.speak("hello"));
    await nextTask();

    // The stream is open and its format is known, but nothing has been handed
    // to the speakers yet.
    expect(player.generateAudioStream).toHaveBeenCalledTimes(1);
    expect(countEvents(emitter, "tts:audio:start")).toBe(0);

    player.stream.push(silence(960)); // 1,920 bytes
    await nextTask();

    expect(countEvents(emitter, "tts:audio:start")).toBe(1);
    expect(playbackContext().sources).toHaveLength(1);

    // The queue running dry mid-utterance and refilling is a scheduling
    // transition, not a second utterance.
    playbackContext().sources[0]!.end();
    player.stream.push(silence(960));
    await nextTask();

    expect(playbackContext().sources).toHaveLength(2);
    expect(countEvents(emitter, "tts:audio:start")).toBe(1);
    expect(countEvents(emitter, "tts:audio:end")).toBe(0);
    expect(speaking.state).toBe("pending");

    player.stream.close();
    await nextTask();
    playbackContext().sources[1]!.end();
    await speaking.promise;
  });

  it("stays pending when the queue drains while the body is still open", async () => {
    const player = new StreamingPlayer();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter(emitter);

    const speaking = track(manager.speak("hello"));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    playbackContext().sources[0]!.end();
    await nextTask();

    // The queue emptied, but the utterance has not ended: more audio may
    // still arrive.
    expect(countEvents(emitter, "tts:audio:end")).toBe(0);
    expect(speaking.state).toBe("pending");

    // The second fact arrives last, with nothing queued behind it.
    player.stream.close();
    await speaking.promise;

    expect(emitter.emit.mock.calls.slice(-2)).toEqual([
      ["tts:lipsync:update", { rms: 0 }],
      ["tts:audio:end", {}],
    ]);
    expect(countEvents(emitter, "tts:audio:end")).toBe(1);
  });

  it("stays pending when the body ends while a source is still sounding", async () => {
    const player = new StreamingPlayer();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter(emitter);

    const speaking = track(manager.speak("hello"));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    player.stream.close();
    await nextTask();

    expect(countEvents(emitter, "tts:audio:end")).toBe(0);
    expect(speaking.state).toBe("pending");

    playbackContext().sources[0]!.end();
    await speaking.promise;

    expect(emitter.emit.mock.calls.slice(-2)).toEqual([
      ["tts:lipsync:update", { rms: 0 }],
      ["tts:audio:end", {}],
    ]);
    expect(countEvents(emitter, "tts:audio:end")).toBe(1);
  });

  it("carries a chunk's odd trailing byte into the next chunk", async () => {
    const player = new StreamingPlayer();
    const manager = trackManager(player);

    const speaking = track(manager.speak("hello"));
    await nextTask();

    player.stream.push(new Uint8Array([0x01, 0x02, 0x03]));
    await nextTask();
    player.stream.push(new Uint8Array([0x04, 0x05, 0x06]));
    await nextTask();

    const context = playbackContext();
    // Three whole samples reach the scheduler: 0x03 waited for the read that
    // completed it instead of being floored away.
    expect(context.buffers.map((buffer) => buffer.length)).toEqual([1, 2]);
    expect(context.buffers[0]!.getChannelData()[0]).toBe(0x0201 / 32768);
    expect(context.buffers[1]!.getChannelData()[0]).toBe(0x0403 / 32768);
    expect(context.buffers[1]!.getChannelData()[1]).toBe(0x0605 / 32768);

    player.stream.close();
    await nextTask();
    context.sources.forEach((source) => source.end());
    await speaking.promise;
  });

  it("drops a lone trailing byte when the body ends", async () => {
    const player = new StreamingPlayer();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter(emitter);

    const speaking = track(manager.speak("hello"));
    await nextTask();

    player.stream.push(new Uint8Array([0x07]));
    await nextTask();
    player.stream.close();
    await speaking.promise;

    expect(playbackContext().buffers).toHaveLength(0);
    expect(countEvents(emitter, "tts:audio:start")).toBe(0);
  });

  it("feeds lip sync from the graph's tap instead of a media element", async () => {
    const player = new StreamingPlayer();
    const manager = trackManager(player);

    const speaking = track(manager.speak("hello"));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    expect(analyzerContext().createMediaStreamSource).toHaveBeenCalledWith(
      playbackContext().tap.stream,
    );
    expect(analyzerContext().createMediaElementSource).not.toHaveBeenCalled();
    expect(playbackContext().createMediaElementSource).not.toHaveBeenCalled();

    player.stream.close();
    await nextTask();
    playbackContext().sources[0]!.end();
    await speaking.promise;
  });

  it("applies options.volume to the graph gain and resets it for the next utterance", async () => {
    const player = new StreamingPlayer();
    const manager = trackManager(player);

    const first = track(manager.speak("quiet", { volume: 0.25 }));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    const gain = playbackContext().gains[0]!;
    expect(gain.gain.value).toBe(0.25);
    // The gain is on the path the audio actually takes, not beside it.
    expect(playbackContext().sources[0]!.connect).toHaveBeenCalledWith(gain);

    player.stream.close();
    await nextTask();
    playbackContext().sources[0]!.end();
    await first.promise;

    const second = track(manager.speak("normal"));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    expect(gain.gain.value).toBe(1);
    expect(playbackContext().sources[1]!.connect).toHaveBeenCalledWith(gain);

    player.stream.close();
    await nextTask();
    playbackContext().sources[1]!.end();
    await second.promise;
  });

  it("stops the queue and the route when the body fails mid-utterance", async () => {
    const player = new StreamingPlayer();
    const emitter = { emit: vi.fn() };
    const manager = trackManager(player);
    manager.setEventEmitter(emitter);

    const speaking = track(manager.speak("hello"));
    await nextTask();
    player.stream.push(silence(960));
    await nextTask();

    player.stream.error(new Error("connection dropped"));

    await expect(speaking.promise).rejects.toThrow(/connection dropped/);
    // Rejecting is not enough: what was queued must stop sounding and the
    // route must stop synthesizing, because finalize has just dropped the
    // handles a later stop() would have reached them through.
    expect(playbackContext().sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(player.signals[0]!.aborted).toBe(true);
    expect(countEvents(emitter, "tts:audio:end")).toBe(1);
  });
});
