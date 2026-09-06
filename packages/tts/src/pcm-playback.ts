import type { TTSPcmFormat } from "@charivo/core";

/**
 * A port of `packages/realtime/src/gemini/playback.ts`, differing only in
 * taking the sample layout as a `TTSPcmFormat` instead of pinning it to the
 * realtime output rate.
 *
 * It is a copy on purpose: `@charivo/tts` cannot import a sibling modality
 * package, and the shape that would avoid the duplication — lifting the
 * scheduler into `@charivo/core` behind a factory — rewires `@charivo/realtime`
 * and moves its tests, which was outside this change. The fork is therefore
 * declared rather than hidden, so a fix on either side gets carried to the
 * other.
 *
 * That inheritance includes a defect, measured rather than hypothetical: the
 * opening chunk of an utterance is short enough to finish before its successor
 * arrives, so the scheduler drains 3 ms into a twelve-second reply and then
 * resumes (`tests/gemini-live-smoke/README.md`). Hence `onDrain` below reports
 * that the queue emptied and never that the utterance ended.
 */

/** The audible playback path plus a silent tap carrying the same signal. */
export interface PcmPlaybackGraph {
  /** Where scheduled sources connect; fans out to the speakers and the tap. */
  output: GainNode;
  /** Hand to `LipSyncAnalyzer.attachMediaStream()`. */
  lipSyncStream: MediaStream;
}

/**
 * The tap is how lip sync gets fed. The analyzer owns its own `AudioContext`
 * and `AudioNode`s cannot connect across contexts, so handing it a node would
 * drag that whole lifecycle in here; a `MediaStreamAudioDestinationNode` beside
 * the audible connection costs one node and leaves the analyzer's existing
 * `attachMediaStream()` untouched (`tests/gemini-live-smoke/README.md`, design
 * consequences).
 */
export function createPcmPlaybackGraph(
  context: AudioContext,
): PcmPlaybackGraph {
  const output = context.createGain();
  output.connect(context.destination);

  const tap = context.createMediaStreamDestination();
  output.connect(tap);

  return { output, lipSyncStream: tap.stream };
}

export interface PcmPlaybackSchedulerCallbacks {
  /**
   * Every source this scheduler started has finished — the queue emptied, which
   * is not the same as the utterance ending, and treating it as one is a
   * measured defect rather than a hypothetical: the opening chunk of an
   * utterance is short enough to finish before its successor arrives, so
   * playback drains 3 ms into a twelve-second reply and then resumes
   * (`tests/gemini-live-smoke/README.md`). Deciding that audio ended needs this
   * *and* an ended stream; the scheduler only reports.
   */
  onDrain(): void;
  /** Fired on transitions only, when the scheduler starts or stops sounding. */
  onPlayingChange(playing: boolean): void;
}

/**
 * Owns every scheduled sample, which is the whole point: a streaming provider
 * hands over bytes and closes the stream against its own pacing instead of
 * observing playback, so nothing but this bookkeeping knows when the last thing
 * we scheduled actually finished.
 *
 * It reports that and nothing more. When the utterance's audio has *ended* is
 * the caller's decision, because it takes a second fact this class never sees —
 * see `onDrain`.
 */
export class PcmPlaybackScheduler {
  private nextStartTime = 0;
  /**
   * Bumped by `flush()`. Every source captures the value it was scheduled
   * under, so a discarded utterance's late `onended` cannot report against the
   * one that replaced it.
   */
  private generation = 0;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    /** Mono only; the manager rejects anything else before constructing this. */
    private readonly format: TTSPcmFormat,
    private readonly callbacks: PcmPlaybackSchedulerCallbacks,
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

  /** Schedule one chunk of the declared format after everything already queued. */
  enqueue(pcm: Uint8Array): void {
    const sampleCount = Math.floor(pcm.byteLength / 2);
    if (sampleCount === 0) {
      return;
    }

    const generation = this.generation;
    // A `DataView`, not an `Int16Array` view: a chunk sliced out of a byte
    // stream comes with no 2-byte alignment guarantee, and the typed-array
    // constructor throws on an odd `byteOffset`.
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buffer = this.context.createBuffer(
      1,
      sampleCount,
      this.format.sampleRate,
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
    // `nextStartTime`. `currentTime` is the floor for the first chunk of an
    // utterance and for any chunk that lands after the queue ran dry mid-
    // utterance — without it, that chunk would be scheduled in the past and
    // play immediately.
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
    // utterance's late callback inert, but the nulling is the load-bearing one:
    // an `ended` event that is already queued resolves its handler at dispatch
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
