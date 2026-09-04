/** Rate the Live API expects for `audio/pcm` microphone input. */
const INPUT_SAMPLE_RATE = 16000;
/**
 * 100 ms at 16 kHz. Measured against the realtime package's 20 ms frames: the
 * same interim cadence at a fifth of the websocket messages.
 */
const CAPTURE_FRAME_SAMPLES = 1600;

const CAPTURE_PROCESSOR_NAME = "charivo-gemini-live-stt-capture";

/**
 * How long a flush waits for the worklet's acknowledgement. The audio thread
 * answers within a render quantum whenever it is alive at all, so a deadline
 * this far out expires only when it is not — and the recording's tail is then
 * gone, which the caller has to know before it trusts the transcript.
 */
const FLUSH_TIMEOUT_MS = 250;

/**
 * The capture processor, as source rather than as a module file: an
 * `AudioWorklet` runs on the audio thread and can only be loaded from a URL, so
 * a published package either ships a second entry point for it or hands the
 * browser a blob built from this string. The string keeps the bundle a single
 * file for every consumer.
 *
 * Exported so a test can compile and execute it: no type checker reads a
 * template literal, and the failure a typo in here produces is that every stop
 * loses the tail of its recording. This module is internal to the
 * `./gemini-live` entry point, so the export adds nothing to the package's
 * public surface.
 */
export const CAPTURE_WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.frameSamples = options.processorOptions.frameSamples;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
    this.pending = [];
    // The samples captured after the last full frame are the end of what the
    // user said. Nothing else ever posts them: without this answer they sit in
    // \`pending\` until the context closes and the transcript loses its tail.
    this.port.onmessage = (event) => {
      if (!event.data || event.data.type !== "flush") {
        return;
      }
      if (this.pending.length > 0) {
        this.postFrame(this.pending.splice(0, this.pending.length));
      }
      this.port.postMessage({ type: "flushed" });
    };
  }

  postFrame(chunk) {
    const frame = new Int16Array(chunk.length);
    for (let i = 0; i < chunk.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, chunk[i]));
      frame[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    this.port.postMessage(frame.buffer, [frame.buffer]);
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }

    // Box-average decimation. Not a proper anti-alias filter, but far better
    // than picking every Nth sample, which folds speech harmonics back down.
    // The position accumulator carries the fractional remainder across groups,
    // so a device rate that is not a whole multiple of the target — 44.1 kHz,
    // say — alternates group sizes rather than drifting out of step.
    for (let i = 0; i < channel.length; i += 1) {
      this.sum += channel[i];
      this.count += 1;
      this.position += 1;
      if (this.position >= this.ratio) {
        this.position -= this.ratio;
        this.pending.push(this.count > 0 ? this.sum / this.count : 0);
        this.sum = 0;
        this.count = 0;
      }
    }

    while (this.pending.length >= this.frameSamples) {
      this.postFrame(this.pending.splice(0, this.frameSamples));
    }

    return true;
  }
}

registerProcessor("${CAPTURE_PROCESSOR_NAME}", CaptureProcessor);
`;

export interface CapturePipelineOptions {
  /**
   * A live microphone stream. The pipeline reads it and never stops it — the
   * caller acquired it and tears it down, including on the paths where building
   * this pipeline fails.
   */
  stream: MediaStream;
  /** One frame of little-endian 16-bit PCM at `INPUT_SAMPLE_RATE`. */
  onFrame(frame: Uint8Array): void;
  /**
   * The capture worklet stopped processing and this pipeline will never emit
   * another frame. Required, because the alternative to failing the session is
   * a confident transcript of the silence that followed.
   */
  onError(): void;
}

export interface CapturePipeline {
  /**
   * Ask the worklet for the samples it has buffered below one frame — the tail
   * of the recording — and resolve once they have been handed to `onFrame`.
   *
   * Resolves `{ drained: false }` instead of rejecting when no acknowledgement
   * arrives within `FLUSH_TIMEOUT_MS`: an undrained tail has to fail the stop
   * that asked for it rather than race it, so the outcome is a value the caller
   * branches on.
   *
   * Call it once per pipeline. A second call replaces the first's resolver
   * without clearing its deadline, so that promise would never settle — the
   * same one-shot contract `stop()` states below, for the same reason: there is
   * exactly one stop per pipeline.
   */
  flush(): Promise<{ drained: boolean }>;
  /** Release the audio graph. Not reusable afterwards; build a new pipeline. */
  stop(): void;
}

/**
 * Decimate the microphone to the 16 kHz mono PCM the Live API expects and hand
 * it over one frame at a time.
 */
export async function createCapturePipeline({
  stream,
  onFrame,
  onError,
}: CapturePipelineOptions): Promise<CapturePipeline> {
  // Per-session context, duplicated from the realtime package's capture rather
  // than imported so `@charivo/stt` never depends on `@charivo/realtime` (the
  // convention `packages/realtime/src/gemini/defaults.ts:1-4` records).
  const context = new AudioContext();

  const workletUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET_SOURCE], { type: "application/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(workletUrl);

    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
      processorOptions: {
        targetRate: INPUT_SAMPLE_RATE,
        frameSamples: CAPTURE_FRAME_SAMPLES,
      },
    });
    source.connect(capture);

    let pendingFlush: {
      resolve: (result: { drained: boolean }) => void;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const settleFlush = (drained: boolean) => {
      const flushing = pendingFlush;
      if (!flushing) {
        return;
      }
      pendingFlush = null;
      clearTimeout(flushing.timer);
      flushing.resolve({ drained });
    };

    capture.port.onmessage = (event: MessageEvent<unknown>) => {
      // Audio frames come over as raw buffers, control messages as objects.
      if (event.data instanceof ArrayBuffer) {
        onFrame(new Uint8Array(event.data));
        return;
      }
      if ((event.data as { type?: string } | null)?.type === "flushed") {
        settleFlush(true);
      }
    };
    // A throw inside `process()` is terminal and otherwise silent: the browser
    // stops calling the processor, the node emits nothing ever again, and the
    // session stays connected and healthy-looking while the model simply never
    // hears the user. This event is the only notice given. A parse error in the
    // source string is already loud — it rejects `addModule()` above — but
    // nothing else covers a runtime throw in a template literal no tool checks.
    capture.onprocessorerror = () => {
      onError();
    };

    return {
      flush() {
        return new Promise<{ drained: boolean }>((resolve) => {
          pendingFlush = {
            resolve,
            timer: setTimeout(() => settleFlush(false), FLUSH_TIMEOUT_MS),
          };
          capture.port.postMessage({ type: "flush" });
        });
      },
      stop() {
        // Both the nulling and the `close()` below stop a frame that the audio
        // thread already posted, but the nulling is the load-bearing one: a
        // queued message resolves its handler at dispatch time, so clearing the
        // attribute is what keeps it from surfacing after the session it
        // belonged to ended. Closing the port is what releases the entangled
        // pair rather than leaving it to the context teardown — do not drop
        // either on the strength of the other. `onprocessorerror` goes for the
        // same dispatch-time reason, and it matters more than a stray frame
        // does: it fails a session, so a late one would fail the next one.
        capture.port.onmessage = null;
        capture.onprocessorerror = null;
        capture.port.close();
        source.disconnect();
        capture.disconnect();
        void closeContext(context);
      },
    };
  } catch (error) {
    // Covers the whole build, not just the module load: until this function
    // returns, nothing else holds a reference that could close the context, and
    // browsers cap how many a page may keep open while the caller retries.
    void closeContext(context);
    throw error;
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
}

function closeContext(context: AudioContext): Promise<void> {
  return context
    .close()
    .catch((error) =>
      console.error("Failed to close the capture audio context:", error),
    );
}
