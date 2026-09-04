import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  type STTOptions,
  type STTTranscriber,
} from "@charivo/core";
import { createCapturePipeline, type CapturePipeline } from "./capture";

const TRANSCRIPTION_MODEL = "gemini-3.5-transcribe-live";
const OPEN_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const FINALIZE_TIMEOUT_MS = 5_000;
/** What the Live API calls the PCM the capture pipeline produces. */
const INPUT_MIME_TYPE = "audio/pcm;rate=16000";

export interface GeminiLiveTranscriptionSessionRequest {
  session: { model: string; language?: string };
}

export interface GeminiLiveTranscriptionBootstrap {
  url: string;
  token: string;
}

export type GeminiLiveTranscriptionBootstrapFn = (
  request: GeminiLiveTranscriptionSessionRequest,
) => Promise<GeminiLiveTranscriptionBootstrap>;

export interface GeminiLiveSTTTranscriberConfig {
  bootstrap: GeminiLiveTranscriptionBootstrapFn;
}

/**
 * Top-level server frame, narrowed to what this client reads. The transcript
 * fields are `unknown` because they are parsed wire data: an absent `text` is
 * the proto3 default (see `decodeTranscriptText`), but a `text` that is present
 * and not a string is a lost transcript rather than something to ignore.
 *
 * `voiceActivity` (top-level, beside an empty `serverContent`) and
 * `serverContent.generationComplete` are read by nothing on purpose: under
 * manual VAD the client declares the only activity boundary, so the server's
 * view of it decides nothing here. `sessionResumptionUpdate`, `goAway`, and
 * `usageMetadata` are unread for the reason
 * `packages/realtime/src/gemini/client.ts` records above its `serverContent`
 * guard — a resumption handle is a session credential, and this session is
 * minted `uses: 1`, so resuming one would have to be re-minted server-side
 * anyway.
 */
interface GeminiServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    interimInputTranscription?: { text?: unknown };
    inputTranscription?: { text?: unknown };
  };
}

/**
 * A socket plus the session generation it belongs to, after
 * `GeminiSocketBinding` in `packages/realtime/src/gemini/client.ts`: every
 * handler closes over its own binding, and each socket gets its own message
 * pump, so a torn-down session's queued frames are abandoned rather than
 * applied to — or queued ahead of — the next session's.
 */
interface SocketBinding {
  socket: WebSocket;
  gen: number;
  pump: Promise<void>;
}

/**
 * Gemini Live streaming STT Transcriber
 *
 * Streams 16 kHz PCM over the Live API websocket under manual voice-activity
 * detection: the server segments nothing, so this client owns the only
 * boundary there is — `activityStart` at start, `activityEnd` at stop — and
 * the whole recording is transcribed as one turn instead of being cut at every
 * pause.
 *
 * While recording, each interim is the whole recording so far rather than a
 * delta — the measured behaviour `handleServerMessage` records — so it is
 * emitted as the current snapshot and deduplicated against what subscribers
 * last saw. The final that answers the stop may revise the tail of that
 * snapshot, so it is emitted too whenever it differs, and subscribers converge
 * on the transcript stop returns, modulo the trim `maybeResolveStop` applies.
 *
 * Stop flushes the capture worklet first, so the samples buffered below one
 * frame — the end of what the user said — go out as audio BEFORE `activityEnd`.
 * A flush the worklet never acknowledges fails the stop, because a transcript
 * quietly missing its last samples is worse than a visible error. Only an
 * `inputTranscription` that ARRIVED after `activityEnd` answers the stop, for
 * the reason `maybeResolveStop` records. A recording that sent no audio at all
 * resolves `""`, and a stop with no final within FINALIZE_TIMEOUT_MS is a
 * CharivoTimeoutError rather than a truncated success.
 * A recording of pure silence is that second case: the server answers audio it
 * heard no speech in with no `inputTranscription` at all (measured), so the
 * stop rejects at the deadline instead of resolving an empty transcript.
 *
 * Nothing is banked mid-recording, so losing the connection loses the whole
 * utterance. That is parity with `@charivo/stt/openai-realtime`, which likewise
 * finalizes with exactly one commit at stop, not a regression against it.
 *
 * The session is bootstrapped by the consumer-supplied `bootstrap` function, so
 * no credential ever lives in this package.
 */
class GeminiLiveSTTTranscriber implements STTTranscriber {
  private mediaStream: MediaStream | null = null;
  private binding: SocketBinding | null = null;
  private capture: CapturePipeline | null = null;
  // Session epoch. Every per-session callback captures the value from its
  // startRecording() call and ignores events once cleanup() has bumped it, so
  // listeners still attached to a closing socket cannot mutate a newer session.
  private generation = 0;
  private connecting = false;
  private recording = false;
  private stopPending = false;
  private isCleaningUp = false;
  private terminalError: Error | null = null;
  private setupError: Error | null = null;
  private setupReject: ((error: Error) => void) | null = null;
  private pendingStop: {
    resolve: (transcription: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private openGate: {
    resolve: () => void;
    reject: (error: Error) => void;
    settled: boolean;
  } | null = null;
  private openTimer?: ReturnType<typeof setTimeout>;
  private stopTimer?: ReturnType<typeof setTimeout>;
  // `snapshot` is what the server last said, `lastEmitted` what subscribers
  // last saw.
  private snapshot = "";
  private lastEmitted = "";
  private activityEnded = false;
  private audioSent = false;
  private partialSubscribers: Array<(transcription: string) => void> = [];
  private readonly handlePageHide = () => this.cleanup();

  constructor(private config: GeminiLiveSTTTranscriberConfig) {}

  /**
   * Open the Live API session and start streaming microphone audio
   */
  async startRecording(options?: STTOptions): Promise<void> {
    if (this.recording || this.connecting) {
      throw new CharivoStateError("already recording");
    }

    this.connecting = true;
    this.stopPending = false;
    this.terminalError = null;
    this.setupError = null;
    this.pendingStop = null;
    this.snapshot = "";
    this.lastEmitted = "";
    this.activityEnded = false;
    this.audioSent = false;
    const gen = ++this.generation;

    // Lets a mid-setup socket failure reject the in-flight setup step instead
    // of hanging until a timeout.
    const setupFailure = new Promise<never>((_, reject) => {
      this.setupReject = reject;
    });
    // Pre-attach a no-op handler so this never-awaited promise cannot surface
    // as an `unhandledrejection` when no race arm is pending.
    void setupFailure.catch(() => {});

    try {
      const micPromise = this.acquireMic();
      // A getUserMedia() permission prompt can resolve after this attempt's
      // setup was canceled or superseded by a newer session; release that late
      // stream instead of leaking a hot mic nothing holds a reference to.
      // Handled separately from the race below, which only decides whether
      // THIS attempt proceeds.
      void micPromise.then(
        (stream) => {
          if (gen !== this.generation) {
            stream.getTracks().forEach((track) => track.stop());
          }
        },
        () => {},
      );
      const stream = await Promise.race([micPromise, setupFailure]);
      // This race's non-setupFailure arm can win even after a cancellation,
      // if it had already settled before cancelConnecting() ran — the same
      // late-release case the .then() above exists for, but reached through
      // the race instead of after it. Re-check before writing `this.mediaStream`
      // so a stale continuation cannot clobber a retry's stream.
      if (gen !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        throw new CharivoStateError(
          "start canceled because stop was called while connecting",
        );
      }
      this.mediaStream = stream;

      const { url, token } = resolveBootstrap(
        await this.raceBootstrap(
          this.config.bootstrap({
            session: {
              model: TRANSCRIPTION_MODEL,
              language: options?.language,
            },
          }),
          setupFailure,
        ),
      );

      this.openSocket(url, token, gen);
      await Promise.race([this.waitForSetupComplete(gen), setupFailure]);
      // Same one-step-past case as above: without this check, a stale
      // continuation would send activityStart on `this.binding`, which by
      // now may belong to a retry's session.
      if (gen !== this.generation) {
        throw new CharivoStateError(
          "start canceled because stop was called while connecting",
        );
      }

      // Manual VAD: the server detects no boundary of its own, so this frame is
      // what opens the one activity the whole recording belongs to. A send
      // failure here fails the setup rather than leaving a session nothing is
      // listening to.
      this.binding!.socket.send(
        JSON.stringify({ realtimeInput: { activityStart: {} } }),
      );

      const capturePromise = createCapturePipeline({
        stream,
        onFrame: (frame) => this.sendAudioFrame(frame),
        // Routed like every other failure source in this class: the pipeline is
        // built while the session is still connecting, so a failure inside that
        // window has to fail the in-flight start rather than become a terminal
        // error the start then walks over by going live on a stopped pipeline.
        onError: () =>
          this.failOpenOrTerminal(
            new CharivoProviderError("capture worklet stopped processing"),
          ),
      });
      // The late-release pattern the microphone above uses: a pipeline that
      // finishes building after this attempt was canceled or superseded owns an
      // AudioContext no later cleanup() can reach, so stop it here.
      void capturePromise.then(
        (pipeline) => {
          if (gen !== this.generation) {
            pipeline.stop();
          }
        },
        () => {},
      );
      const capture = await Promise.race([capturePromise, setupFailure]);
      // Same one-step-past case again: without this check, a stale
      // continuation would write `this.capture`, clobbering a retry's pipeline.
      if (gen !== this.generation) {
        capture.stop();
        throw new CharivoStateError(
          "start canceled because stop was called while connecting",
        );
      }
      this.capture = capture;

      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", this.handlePageHide);
      }

      this.recording = true;
    } catch (error) {
      // Read under the same gate as the cleanup below: a canceled start's
      // setupError is only trustworthy for THIS generation. Once a retry has
      // reset it (or set its own), reading it unconditionally would reject
      // this attempt with the retry's failure instead of its own cancel
      // message — the type contract holds either way, but the message would
      // be wrong.
      const failure =
        (gen === this.generation ? this.setupError : null) ?? error;
      // A cancellation (cancelConnecting()) already cleaned this generation up
      // and may have let a retry begin before this catch runs: touching
      // cleanup() or the shared fields below unconditionally would tear the
      // retry's socket/mic down and clobber its connecting/setupReject state.
      // This attempt still has to reject with its own failure regardless.
      if (gen === this.generation) {
        this.cleanup();
        this.terminalError = null;
        this.setupError = null;
      }
      throw failure;
    } finally {
      // cleanup() (just above, or from an earlier cancellation) already owns
      // `connecting` and `setupReject` on every failure path — it bumps the
      // generation, so `gen === this.generation` is false by the time this
      // runs whenever cleanup() ran for THIS attempt. This only ever fires on
      // the success path, to clear them once the session finishes connecting.
      if (gen === this.generation) {
        this.connecting = false;
        this.setupReject = null;
      }
    }
  }

  /**
   * Close the activity and resolve with the transcript of the whole recording
   */
  async stopRecording(): Promise<string> {
    if (this.terminalError) {
      const error = this.terminalError;
      this.terminalError = null;
      this.cleanup();
      throw error;
    }
    if (this.stopPending) {
      throw new CharivoStateError("stop already in progress");
    }
    if (this.connecting) {
      // Nothing was transcribed yet, so canceling a connecting session is a
      // successful, idempotent stop, not an error — the same "" contract as
      // the !this.recording case below. This keeps dispose(), which sees
      // isRecording() === true while connecting, from surfacing a thrown error
      // for what is, from the caller's perspective, a clean teardown.
      this.cancelConnecting();
      return "";
    }
    if (!this.recording) {
      return "";
    }

    this.stopPending = true;
    const gen = this.generation;

    // Registered before the handshake starts: the worklet can answer the flush
    // synchronously, and the final can follow it, so the stop has to be
    // resolvable by the time finalizeStop() runs at all.
    const stopped = new Promise<string>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
      this.stopTimer = setTimeout(
        () =>
          this.rejectPendingStop(
            new CharivoTimeoutError(
              `stop timed out after ${FINALIZE_TIMEOUT_MS}ms waiting for the final transcript`,
            ),
          ),
        FINALIZE_TIMEOUT_MS,
      );
    }).then(
      (text) => {
        this.cleanup();
        return text;
      },
      (error: unknown) => {
        this.terminalError = null;
        this.cleanup();
        throw error;
      },
    );

    // finalizeStop() settles the stop itself on every path it can reach, so a
    // rejection here is a bug rather than an outcome; swallowing it keeps an
    // unhandled rejection off the page, and the deadline above still settles
    // the stop.
    void this.finalizeStop(gen).catch(() => {});

    return stopped;
  }

  /**
   * Check if currently recording, including while a session is still
   * connecting: lifecycle owners like Charivo.dispose() gate their stop call
   * on this, so a connecting session must count as active.
   */
  isRecording(): boolean {
    return this.recording || this.connecting;
  }

  /**
   * Subscribe to cumulative interim transcript snapshots
   */
  onPartial(callback: (transcription: string) => void): void {
    this.partialSubscribers.push(callback);
  }

  /**
   * Hand one capture frame to the server, or drop it. Audio outside the open
   * activity is not late data the server can place — under manual VAD it
   * belongs to no turn at all, so a frame that misses the window is discarded
   * rather than sent.
   *
   * The `activityEnded` check is defensive, and deliberately so: it encodes a
   * wire-protocol invariant the SERVER would observe being violated — audio
   * arriving inside an activity the client already closed — rather than
   * merely an internal state assertion, and the field exists regardless (the
   * pump captures it at frame arrival for `maybeResolveStop`'s eligibility
   * rule). It is unreachable under the current ordering: finalizeStop() and
   * cleanup() both stop the capture pipeline — which nulls `port.onmessage` —
   * before either one sets the flag, so no frame this method sees can ever
   * find it true. Nothing tests it in isolation for the same reason: a test
   * that reached it would have to call a handler the platform has already
   * detached. Keep it anyway: it costs one comparison, and the alternative to
   * dropping a frame that somehow arrives late is sending audio into a turn
   * that is not open.
   */
  private sendAudioFrame(frame: Uint8Array): void {
    const socket = this.binding?.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || this.activityEnded) {
      return;
    }

    socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: bytesToBase64(frame), mimeType: INPUT_MIME_TYPE },
        },
      }),
    );
    this.audioSent = true;
  }

  private async acquireMic(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  private async raceBootstrap(
    bootstrapPromise: Promise<GeminiLiveTranscriptionBootstrap>,
    setupFailure: Promise<never>,
  ): Promise<GeminiLiveTranscriptionBootstrap> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new CharivoTimeoutError(
              `streaming STT bootstrap timed out after ${BOOTSTRAP_TIMEOUT_MS}ms`,
            ),
          ),
        BOOTSTRAP_TIMEOUT_MS,
      );
    });

    try {
      return await Promise.race([bootstrapPromise, setupFailure, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private openSocket(url: string, token: string, gen: number): void {
    // Parsed rather than concatenated so a bootstrap url that already carries
    // a query string still gets the token appended correctly, and validated
    // before the token is attached: a bootstrap misconfiguration should read
    // as one, not as the network fault the scrubbed message below is
    // reserved for. Neither failure here can carry the token, since it is
    // not attached yet.
    let endpoint: URL;
    try {
      endpoint = new URL(url);
    } catch {
      throw new CharivoProviderError(
        "bootstrap url is not a valid websocket URL",
      );
    }
    if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
      throw new CharivoProviderError("bootstrap url must use ws: or wss:");
    }

    let socket: WebSocket;
    try {
      // The endpoint accepts the ephemeral token only as a query parameter,
      // so the built URL is a credential from here on: a constructor failure
      // is re-thrown as a bare message because the native one quotes the URL.
      endpoint.searchParams.set("access_token", token);
      socket = new WebSocket(endpoint.toString());
    } catch {
      throw new CharivoProviderError(
        "failed to open the Gemini Live websocket",
      );
    }

    // startRecording() can advance exactly one step past a cancellation: the
    // step whose non-failure race arm had already settled before
    // cancelConnecting() ran. If that step was this one, the socket above is
    // real and already carries the token, so it needs the same late-release
    // the mic and capture pipeline already have for what they acquire after
    // theirs — closed here, before `this.binding` is touched, so a retry
    // already in flight is never clobbered.
    if (gen !== this.generation) {
      socket.close();
      throw new CharivoStateError(
        "start canceled because stop was called while connecting",
      );
    }

    const binding: SocketBinding = { socket, gen, pump: Promise.resolve() };
    this.binding = binding;

    socket.onopen = () => {
      if (gen !== this.generation) {
        return;
      }
      // The token's `bidiGenerateContentSetup` replaces this frame wholesale,
      // but the server acknowledges nothing until the client sends one
      // (measured), so it carries the same manual-VAD configuration the mint
      // body pins.
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${TRANSCRIPTION_MODEL}`,
            generationConfig: { responseModalities: ["TEXT"] },
            inputAudioTranscription: { mode: "VERBATIM" },
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: true },
            },
          },
        }),
      );
    };

    socket.onmessage = (event: MessageEvent) => {
      this.enqueueServerMessage(binding, event.data);
    };

    socket.onerror = () => {
      if (gen !== this.generation || this.isCleaningUp) {
        return;
      }
      this.failOpenOrTerminal(
        new CharivoProviderError("Gemini Live websocket error"),
      );
    };

    // The close code is a diagnostic; the server's reason is not carried,
    // because nothing keeps a session credential out of it.
    socket.onclose = (event: CloseEvent) => {
      if (gen !== this.generation || this.isCleaningUp) {
        return;
      }
      this.failOpenOrTerminal(
        new CharivoProviderError(
          `Gemini Live websocket closed (code ${event.code})`,
        ),
      );
    };
  }

  private enqueueServerMessage(binding: SocketBinding, data: unknown): void {
    if (binding.gen !== this.generation) {
      return;
    }

    // Read here, where the frame ARRIVED, and carried through the pump: the
    // pump is asynchronous between arrival and handling, so a `Blob` that
    // reached us before `activityEnd` can still be inside text() when it goes
    // out. Deciding at handling time would answer the stop with that frame and
    // lose everything the user said after it.
    const arrivedAfterActivityEnd = this.activityEnded;

    binding.pump = binding.pump.then(async () => {
      let payload: unknown;
      try {
        const raw = data instanceof Blob ? await data.text() : data;

        // Re-checked after the await, not only at enqueue: a `Blob.text()` can
        // resolve after cleanup() tore this session down, and applying it then
        // would mutate a session this payload never belonged to.
        if (binding.gen !== this.generation) {
          return;
        }
        if (typeof raw !== "string") {
          throw new TypeError("unreadable frame");
        }
        payload = JSON.parse(raw);
      } catch {
        // The frame text never reaches the message: Live API frames carry
        // session credentials, and this error surfaces to app code.
        this.failOpenOrTerminal(
          new CharivoProviderError("malformed Gemini Live message"),
        );
        return;
      }

      if (typeof payload !== "object" || payload === null) {
        this.failOpenOrTerminal(
          new CharivoProviderError("malformed Gemini Live message"),
        );
        return;
      }
      this.handleServerMessage(
        payload as GeminiServerMessage,
        arrivedAfterActivityEnd,
      );
    });
  }

  private handleServerMessage(
    message: GeminiServerMessage,
    arrivedAfterActivityEnd: boolean,
  ): void {
    if (message.setupComplete) {
      this.resolveOpenGate();
      return;
    }

    const content = message.serverContent;
    if (!content) {
      return;
    }

    const interim = content.interimInputTranscription;
    if (interim) {
      const text = decodeTranscriptText(interim.text);
      if (text === null) {
        this.failOpenOrTerminal(
          new CharivoProviderError("malformed Gemini Live message"),
        );
        return;
      }
      // Each interim is the whole recording so far (measured), never a delta
      // and never reset across a pause, so it replaces the snapshot rather than
      // extending it: the server, not this client, supplies the separator.
      this.snapshot = text;
      this.emitPartial();
    }

    const final = content.inputTranscription;
    if (final) {
      const text = decodeTranscriptText(final.text);
      if (text === null) {
        this.failOpenOrTerminal(
          new CharivoProviderError("malformed Gemini Live message"),
        );
        return;
      }
      this.snapshot = text;
      this.emitPartial();
      // Whether this final answers a stop is the stop path's decision, on the
      // arrival rule `maybeResolveStop` records.
      this.maybeResolveStop(arrivedAfterActivityEnd);
    }
  }

  /**
   * Hand the snapshot to subscribers, but only when it changed. The server
   * repeats the interim unchanged while the speaker is silent (8 identical
   * frames across a measured 1.5 s gap), and a subscriber redrawing a draft
   * has nothing to do with those. What is recorded is what was EMITTED, so a
   * final that repeats the text its last interim already showed emits nothing.
   *
   * A shorter snapshot is emitted as given: nothing here enforces
   * monotonicity, because suppressing a revision would leave subscribers
   * holding text the transcript stop returns no longer contains.
   */
  private emitPartial(): void {
    if (this.snapshot === this.lastEmitted) {
      return;
    }
    this.lastEmitted = this.snapshot;
    for (const callback of this.partialSubscribers) {
      callback(this.snapshot);
    }
  }

  /**
   * Settle a stop that is already in flight with the final just applied, but
   * only if that final is eligible: eligibility is having ARRIVED after
   * `activityEnd` went out, because an earlier one cannot be known to cover the
   * audio sent after it. That is the only rule, and the flag is the only place
   * it is read — `activityEnded` says where the session is now, which for a
   * frame the pump held is a different question.
   *
   * The snapshot is trimmed here and nowhere else. Partials stay exactly as the
   * server sent them, and the transcript a caller keeps is the trimmed one —
   * the same split `buildFinal()` makes in `@charivo/stt/openai-realtime`. So
   * the last partial equals what stop resolves MODULO that trim, and nothing
   * else: a final that revises the tail is emitted before it is trimmed, so no
   * subscriber is left holding text the transcript contradicts.
   */
  private maybeResolveStop(arrivedAfterActivityEnd: boolean): void {
    if (!this.stopPending || !this.pendingStop || !arrivedAfterActivityEnd) {
      return;
    }
    this.resolvePendingStop(this.snapshot.trim());
  }

  private waitForSetupComplete(gen: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.openGate = { resolve, reject, settled: false };
      this.openTimer = setTimeout(() => {
        if (gen !== this.generation) {
          return;
        }
        this.rejectOpenGate(
          new CharivoTimeoutError(
            `streaming STT session setup did not complete within ${OPEN_TIMEOUT_MS}ms`,
          ),
        );
      }, OPEN_TIMEOUT_MS);
    });
  }

  private resolveOpenGate(): void {
    clearTimeout(this.openTimer);
    this.openTimer = undefined;
    const gate = this.openGate;
    this.openGate = null;
    if (!gate || gate.settled) {
      return;
    }
    gate.settled = true;
    gate.resolve();
  }

  private rejectOpenGate(error: Error): void {
    clearTimeout(this.openTimer);
    this.openTimer = undefined;
    const gate = this.openGate;
    this.openGate = null;
    if (!gate || gate.settled) {
      return;
    }
    gate.settled = true;
    gate.reject(error);
  }

  private failOpenOrTerminal(error: Error): void {
    // Order matters: a setup-phase failure must reject the awaited setup step
    // rather than become a terminal error that only surfaces at stopRecording().
    if (this.openGate && !this.openGate.settled) {
      this.rejectOpenGate(error);
    } else if (this.connecting) {
      this.setupError ??= error;
      this.setupReject?.(error);
    } else {
      this.failTerminal(error);
    }
  }

  private failTerminal(error: Error): void {
    if (this.terminalError) {
      return;
    }
    this.terminalError = error;
    this.cleanup();
  }

  // Cancels the in-flight startRecording(). Runs cleanup() synchronously so a
  // caller awaiting stopRecording() sees every resource acquired so far (mic,
  // socket, capture, timers, pagehide listener) already released by the time
  // it returns. Every step in startRecording()'s try block re-checks the
  // generation before touching `this` again, so the setup step it is
  // currently awaiting rejects with this cancel message instead of resuming
  // and acquiring or writing one more thing. The open gate is rejected with
  // the cancel reason FIRST, before cleanup() reaches for its own generic
  // "recording ended": cleanup()'s `if (this.openGate && !this.openGate.settled)`
  // is then a no-op, since rejectOpenGate() already settled and cleared it.
  // setupReject is captured before cleanup() runs because cleanup() nulls it
  // as part of tearing this generation down.
  private cancelConnecting(): void {
    const error = new CharivoStateError(
      "start canceled because stop was called while connecting",
    );
    this.setupError ??= error;
    const reject = this.setupReject;
    this.rejectOpenGate(error);
    this.cleanup();
    reject?.(error);
  }

  /**
   * Drain the capture worklet, then close the activity the recording belongs
   * to. Settles the pending stop itself on every path that cannot get as far
   * as `activityEnd`.
   */
  private async finalizeStop(gen: number): Promise<void> {
    // Held across the await so the pipeline this stop started can still be
    // stopped after the field has been cleared below.
    const capture = this.capture!;
    const { drained } = await capture.flush();

    // The session was settled and cleaned up while the flush was in flight;
    // cleanup() already released this pipeline and rejected the stop.
    if (gen !== this.generation || !this.pendingStop) {
      return;
    }

    // Out of the field before it is stopped, so the cleanup that follows the
    // settled stop cannot stop the same pipeline a second time.
    this.capture = null;
    capture.stop();

    if (!drained) {
      // The tail of the recording never left the audio thread. Closing the
      // activity now would return a confident transcript of everything but the
      // last thing the user said.
      this.rejectPendingStop(
        new CharivoProviderError("capture worklet did not drain before stop"),
      );
      return;
    }
    if (!this.audioSent) {
      // No audio was ever sent, so there is no turn to close and no final to
      // wait for.
      this.resolvePendingStop("");
      return;
    }

    try {
      this.binding!.socket.send(
        JSON.stringify({ realtimeInput: { activityEnd: {} } }),
      );
    } catch (error) {
      this.failTerminal(
        error instanceof Error
          ? error
          : new CharivoProviderError("failed to end the activity"),
      );
      return;
    }
    this.activityEnded = true;
  }

  private resolvePendingStop(transcription: string): void {
    const pending = this.pendingStop;
    if (!pending) {
      return;
    }
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    this.pendingStop = null;
    pending.resolve(transcription);
  }

  private rejectPendingStop(error: Error): void {
    const pending = this.pendingStop;
    if (!pending) {
      return;
    }
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    this.pendingStop = null;
    pending.reject(error);
  }

  private cleanup(): void {
    if (this.isCleaningUp) {
      return;
    }
    this.isCleaningUp = true;
    try {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
      clearTimeout(this.openTimer);
      this.openTimer = undefined;
      if (this.openGate && !this.openGate.settled) {
        const gate = this.openGate;
        gate.settled = true;
        gate.reject(new CharivoStateError("recording ended"));
      }
      this.openGate = null;
      if (this.pendingStop) {
        this.rejectPendingStop(
          this.terminalError ?? new CharivoStateError("recording ended"),
        );
      }
      // Taken out of the field before it is stopped: finalizeStop() hands its
      // own pipeline over the same way once the flush has answered, so no
      // pipeline is ever stopped twice.
      const capture = this.capture;
      this.capture = null;
      capture?.stop();
      this.mediaStream?.getTracks().forEach((track) => track.stop());
      this.binding?.socket.close();
      this.binding = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", this.handlePageHide);
      }
      this.mediaStream = null;
      this.recording = false;
      this.connecting = false;
      this.setupReject = null;
      this.stopPending = false;
      this.activityEnded = false;
      this.audioSent = false;
      this.snapshot = "";
      this.lastEmitted = "";
      // Invalidate every callback still bound to the torn-down session.
      this.generation++;
    } finally {
      this.isCleaningUp = false;
    }
  }
}

/**
 * Duplicated from `packages/realtime/src/gemini/client.ts` rather than shared,
 * so `@charivo/stt` never imports `@charivo/realtime`. The chunking stays with
 * it because the trap it avoids is real and silent: `btoa` wants a binary
 * string, and building one with `String.fromCharCode(...bytes)` makes every
 * byte an argument, which throws once a payload outgrows the engine's argument
 * limit.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

/**
 * Read a transcription field's `text`, or `null` when it is unreadable.
 *
 * The two absences are not the same thing. An OMITTED `text` is the proto3
 * default: this API serializes a message whose only field holds its default as
 * `{}` (measured — `setupComplete: {}` and `serverContent: {}` arrive exactly
 * that way), so it decodes as `""` and costs nothing. A `text` that is present
 * and not a string is something else: a serializer emitting one is not omitting
 * a default, so quietly ignoring it would drop a transcript the server did
 * send. That case stays terminal.
 */
function decodeTranscriptText(text: unknown): string | null {
  if (text === undefined) {
    return "";
  }
  return typeof text === "string" ? text : null;
}

function resolveBootstrap(
  bootstrap: GeminiLiveTranscriptionBootstrap,
): GeminiLiveTranscriptionBootstrap {
  const { url, token } = bootstrap ?? {};
  if (typeof url !== "string" || !url || typeof token !== "string" || !token) {
    throw new CharivoProviderError(
      "streaming STT bootstrap is missing its websocket url or token",
    );
  }
  return { url, token };
}

export function createGeminiLiveSTTTranscriber(
  config: GeminiLiveSTTTranscriberConfig,
): STTTranscriber {
  return new GeminiLiveSTTTranscriber(config);
}
