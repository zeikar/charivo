import { OUTPUT_SAMPLE_RATE } from "./defaults";

/** The audible playback path plus a silent tap carrying the same signal. */
export interface PlaybackGraph {
  /** Where scheduled sources connect; fans out to the speakers and the tap. */
  output: AudioNode;
  /** Hand to `LipSyncAnalyzer.attachMediaStream()`. */
  lipSyncStream: MediaStream;
}

/**
 * The tap is how lip sync gets fed. The analyzer owns its own `AudioContext`
 * and `AudioNode`s cannot connect across contexts, so handing it a node would
 * drag that whole lifecycle in here; a `MediaStreamAudioDestinationNode` beside
 * the audible connection costs one node and leaves the analyzer's existing
 * `attachMediaStream()` untouched (`tests/gemini-live-smoke/README.md`, design
 * consequences). No peer connection is involved — the loopback route measured
 * no better than direct on Safari and is retired.
 */
export function createPlaybackGraph(context: AudioContext): PlaybackGraph {
  const output = context.createGain();
  output.connect(context.destination);

  const tap = context.createMediaStreamDestination();
  output.connect(tap);

  return { output, lipSyncStream: tap.stream };
}

export interface PlaybackSchedulerCallbacks {
  /**
   * Every source this scheduler started has finished.
   *
   * This is *not* the end of the model's audio, and treating it as one is a
   * measured defect rather than a hypothetical: the opening chunk of a turn is
   * short enough to finish before its successor arrives, so playback drains
   * 3 ms into a twelve-second reply and then resumes
   * (`tests/gemini-live-smoke/README.md`). Deciding that audio ended needs this
   * *and* `turnComplete`; the scheduler only reports.
   */
  onDrain(): void;
  /** Fired on transitions only, when the scheduler starts or stops sounding. */
  onPlayingChange(playing: boolean): void;
}

/**
 * Owns every scheduled sample, which is the whole point: the server paces
 * `turnComplete` against a clock instead of observing playback, so nothing but
 * this bookkeeping knows when the last thing we scheduled actually finished.
 *
 * It reports that and nothing more. When the model's audio has *ended* is the
 * client's decision, because it takes a second fact this class never sees —
 * see `onDrain`.
 */
export class PlaybackScheduler {
  private nextStartTime = 0;
  /**
   * Bumped by `flush()`. Every source captures the value it was scheduled
   * under, so a discarded turn's late `onended` cannot report against the turn
   * that replaced it.
   */
  private generation = 0;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly callbacks: PlaybackSchedulerCallbacks,
  ) {}

  /**
   * Whether the scheduler has nothing left to play — nothing sounding, and
   * nothing queued behind it. Derived from the live source set on
   * every call rather than remembered: `enqueue()` clears idleness by adding to
   * that set, so a caller cannot be holding a "drained" answer that the next
   * chunk already invalidated.
   */
  isIdle(): boolean {
    return this.active.size === 0;
  }

  /** Schedule one `audio/pcm;rate=24000` chunk after everything already queued. */
  enqueue(pcm: Uint8Array): void {
    const sampleCount = Math.floor(pcm.byteLength / 2);
    if (sampleCount === 0) {
      return;
    }

    const generation = this.generation;
    // A `DataView`, not an `Int16Array` view: the base64-decoded payload comes
    // with no 2-byte alignment guarantee, and the typed-array constructor
    // throws on an odd `byteOffset`.
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buffer = this.context.createBuffer(
      1,
      sampleCount,
      OUTPUT_SAMPLE_RATE,
    );
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < sampleCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    source.onended = () => {
      this.active.delete(source);
      if (generation !== this.generation || this.active.size > 0) {
        return;
      }

      this.callbacks.onPlayingChange(false);
      this.callbacks.onDrain();
    };

    const wasIdle = this.isIdle();
    // Chunks arrive far faster than real time, so they queue back-to-back off
    // `nextStartTime`. `currentTime` is the floor for the first chunk of a turn
    // and for any chunk that lands after the queue ran dry mid-turn — without
    // it, that chunk would be scheduled in the past and play immediately.
    const startAt = Math.max(this.context.currentTime, this.nextStartTime);
    this.active.add(source);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    if (wasIdle) {
      this.callbacks.onPlayingChange(true);
    }
  }

  /** Discard everything scheduled, audible or merely queued. */
  flush(): void {
    // Both this bump and the `source.onended = null` below leave a discarded
    // turn's late callback inert, but the nulling is the load-bearing one: an
    // `ended` event that is already queued resolves its handler at dispatch
    // time, so clearing the attribute is what stops it firing. The counter is
    // defence in depth, covering any closure that outlives the loop below — do
    // not drop the nulling on the strength of it.
    this.generation += 1;
    const wasPlaying = !this.isIdle();

    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not an expected case: per spec `stop()` on a source that already
        // ended is a no-op, and only a `stop()` with no preceding successful
        // `start()` throws. The catch is here for the loop, not for the error —
        // one throw must not abandon the remaining sources still audible.
      }
    }

    this.active.clear();
    this.nextStartTime = 0;

    if (wasPlaying) {
      this.callbacks.onPlayingChange(false);
    }
  }
}
