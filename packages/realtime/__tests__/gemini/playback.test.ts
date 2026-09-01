import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlaybackGraph,
  PlaybackScheduler,
} from "../../src/gemini/playback";
import { OUTPUT_SAMPLE_RATE } from "../../src/gemini/defaults";

class FakeAudioBuffer {
  readonly duration: number;
  private readonly channel: Float32Array;

  constructor(length: number, sampleRate: number) {
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

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  readonly sources: FakeBufferSource[] = [];
  readonly gains: Array<{ connect: ReturnType<typeof vi.fn> }> = [];
  readonly tap = {
    stream: {} as MediaStream,
  };

  createBuffer = vi.fn(
    (_channels: number, length: number, sampleRate: number) =>
      new FakeAudioBuffer(length, sampleRate),
  );
  createBufferSource = vi.fn(() => {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  });
  createGain = vi.fn(() => {
    const gain = { connect: vi.fn() };
    this.gains.push(gain);
    return gain;
  });
  createMediaStreamDestination = vi.fn(() => this.tap);
}

/** `sampleCount` samples of little-endian 16-bit PCM. */
function pcm(sampleCount: number): Uint8Array {
  return new Uint8Array(sampleCount * 2);
}

function createScheduler() {
  const context = new FakeAudioContext();
  const callbacks = {
    onDrain: vi.fn(),
    onPlayingChange: vi.fn((_playing: boolean) => undefined),
  };
  const scheduler = new PlaybackScheduler(
    context as unknown as AudioContext,
    {} as AudioNode,
    callbacks,
  );

  return { context, callbacks, scheduler };
}

describe("PlaybackScheduler", () => {
  let harness: ReturnType<typeof createScheduler>;

  beforeEach(() => {
    harness = createScheduler();
  });

  // The measured trap: the opening chunk of a turn finishes before its
  // successor arrives, so the scheduler drains 3 ms into a twelve-second reply
  // (`tests/gemini-live-smoke/README.md`). The scheduler must report it; the
  // client is what refuses to call it the end of the audio.
  it("reports the opening chunk's drain even though the turn is still arriving", () => {
    const { context, callbacks, scheduler } = harness;

    scheduler.enqueue(pcm(240));
    expect(callbacks.onDrain).not.toHaveBeenCalled();
    expect(scheduler.isIdle()).toBe(false);

    context.sources[0]!.end();

    expect(callbacks.onDrain).toHaveBeenCalledTimes(1);
    expect(scheduler.isIdle()).toBe(true);

    scheduler.enqueue(pcm(240));

    expect(scheduler.isIdle()).toBe(false);
    expect(callbacks.onDrain).toHaveBeenCalledTimes(1);
    expect(callbacks.onPlayingChange.mock.calls.map(([playing]) => playing)) //
      .toEqual([true, false, true]);
  });

  it("leaves a flushed turn's late onended reporting nothing", () => {
    const { context, callbacks, scheduler } = harness;

    scheduler.enqueue(pcm(240));
    // Captured before the flush, which nulls the attribute: this stands in for
    // an `ended` event already queued when the flush ran.
    const lateOnended = context.sources[0]!.onended;
    expect(lateOnended).toBeTypeOf("function");

    scheduler.flush();
    expect(context.sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(context.sources[0]!.onended).toBeNull();

    lateOnended?.();

    expect(callbacks.onDrain).not.toHaveBeenCalled();
    expect(callbacks.onPlayingChange.mock.calls.map(([playing]) => playing)) //
      .toEqual([true, false]);
  });

  it("queues chunks back-to-back and floors a chunk that lands after the queue ran dry", () => {
    const { context, callbacks, scheduler } = harness;
    // 2400 samples at 24 kHz is 100 ms of audio.
    context.currentTime = 10;

    scheduler.enqueue(pcm(2400));
    scheduler.enqueue(pcm(2400));

    expect(context.createBuffer).toHaveBeenLastCalledWith(
      1,
      2400,
      OUTPUT_SAMPLE_RATE,
    );
    expect(context.sources[0]!.start).toHaveBeenCalledWith(10);
    expect(context.sources[1]!.start).toHaveBeenCalledWith(10.1);

    // Still mid-queue: the third chunk goes behind the second, not at the clock.
    context.currentTime = 10.05;
    scheduler.enqueue(pcm(2400));
    expect(context.sources[2]!.start).toHaveBeenCalledWith(10.2);

    // The queue ran dry, so scheduling off `nextStartTime` would start this
    // chunk in the past and play it immediately.
    context.currentTime = 50;
    scheduler.enqueue(pcm(2400));
    expect(context.sources[3]!.start).toHaveBeenCalledWith(50);

    // One sounding stretch: the transitions are what the client meters.
    expect(callbacks.onPlayingChange).toHaveBeenCalledTimes(1);
    expect(callbacks.onPlayingChange).toHaveBeenCalledWith(true);
  });

  it("decodes little-endian samples from an unaligned payload", () => {
    const { context, scheduler } = harness;
    // Base64 decoding gives no 2-byte alignment guarantee, so the payload can
    // start on an odd byte offset — where an `Int16Array` view throws.
    const backing = new Uint8Array([0xff, 0x00, 0x80, 0x00, 0x40]);
    const unaligned = backing.subarray(1);

    scheduler.enqueue(unaligned);

    const channel = context.sources[0]!.buffer!.getChannelData();
    expect(Array.from(channel)).toEqual([-32768 / 32768, 0x4000 / 32768]);
  });

  it("ignores a payload too short to hold one sample", () => {
    const { context, scheduler } = harness;

    scheduler.enqueue(new Uint8Array([0x01]));

    expect(context.sources).toHaveLength(0);
    expect(harness.callbacks.onPlayingChange).not.toHaveBeenCalled();
  });
});

describe("createPlaybackGraph", () => {
  it("fans the audible output out to the speakers and the lip-sync tap", () => {
    const context = new FakeAudioContext();

    const graph = createPlaybackGraph(context as unknown as AudioContext);

    const gain = context.gains[0]!;
    expect(graph.output).toBe(gain);
    expect(gain.connect).toHaveBeenNthCalledWith(1, context.destination);
    expect(gain.connect).toHaveBeenNthCalledWith(2, context.tap);
    expect(graph.lipSyncStream).toBe(context.tap.stream);
  });
});
