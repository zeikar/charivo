import { CAPTURE_FRAME_SAMPLES, INPUT_SAMPLE_RATE } from "./defaults";

const CAPTURE_PROCESSOR_NAME = "charivo-gemini-capture";

/**
 * The capture processor, as source rather than as a module file: an
 * `AudioWorklet` runs on the audio thread and can only be loaded from a URL, so
 * a published package either ships a second entry point for it or hands the
 * browser a blob built from this string. The string keeps the bundle a single
 * file for every consumer.
 */
const CAPTURE_WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.frameSamples = options.processorOptions.frameSamples;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
    this.pending = [];
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
      const chunk = this.pending.splice(0, this.frameSamples);
      const frame = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, chunk[i]));
        frame[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.port.postMessage(frame.buffer, [frame.buffer]);
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
}

export interface CapturePipeline {
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
}: CapturePipelineOptions): Promise<CapturePipeline> {
  // Capture gets its own context, which makes three on this client — playback
  // at 24 kHz, the lip-sync analyzer's own, and this one — where
  // `tests/gemini-live-smoke/README.md` already flags two as fragile on iOS.
  // Running capture on the playback context to stay at two was rejected on two
  // counts. It resamples twice on the path that feeds recognition: the browser
  // takes the 48 kHz microphone down to the playback context's 24 kHz, and the
  // box average below then runs at a ratio of 1.5 — alternating one- and
  // two-sample groups — where the device rate gives a clean 3:1. And the
  // lifetimes disagree: the playback context is built inside a user gesture and
  // outlives every reconnect, while capture is per-session, so sharing would
  // mean unpicking nodes out of a live context on every reset instead of
  // closing this one.
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
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onFrame(new Uint8Array(event.data));
    };
    // A throw inside `process()` is terminal and otherwise silent: the browser
    // stops calling the processor, the node emits nothing ever again, and the
    // session stays connected and healthy-looking while the model simply never
    // hears the user. This event is the only notice given. A parse error in the
    // source string is already loud — it rejects `addModule()` above — but
    // nothing else covers a runtime throw in a template literal no tool checks.
    capture.onprocessorerror = () => {
      console.error("The Gemini capture worklet stopped processing");
    };

    return {
      stop() {
        // Both the nulling and the `close()` below stop a frame that the audio
        // thread already posted, but the nulling is the load-bearing one: a
        // queued message resolves its handler at dispatch time, so clearing the
        // attribute is what keeps it from surfacing after the session it
        // belonged to ended. Closing the port is what releases the entangled
        // pair rather than leaving it to the context teardown — do not drop
        // either on the strength of the other.
        capture.port.onmessage = null;
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
