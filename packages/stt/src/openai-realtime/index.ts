import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  type STTOptions,
  type STTTranscriber,
} from "@charivo/core";

const TRANSCRIPTION_MODEL = "gpt-realtime-whisper";
const OPEN_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 15_000;
const COMMIT_TIMEOUT_MS = 5_000;

export interface OpenAIRealtimeTranscriptionSessionRequest {
  sdpOffer: string;
  session: { model: string; language?: string };
}

export interface OpenAIRealtimeTranscriptionBootstrap {
  answerSdp: string;
}

export type OpenAIRealtimeTranscriptionBootstrapFn = (
  request: OpenAIRealtimeTranscriptionSessionRequest,
) => Promise<OpenAIRealtimeTranscriptionBootstrap>;

export interface OpenAIRealtimeSTTTranscriberConfig {
  bootstrap: OpenAIRealtimeTranscriptionBootstrapFn;
}

interface ServerEvent {
  type: string;
  item_id?: string;
  // `string` for a predecessor, `null` for the root item, or absent.
  previous_item_id?: string | null;
  delta?: string;
  transcript?: string;
  error?: { code?: string; message?: string; event_id?: string };
}

type ItemRecord = {
  deltas: string;
  transcript: string | null;
  completed: boolean;
  // Recorded ONLY from `input_audio_buffer.committed`; the transcription
  // `delta`/`completed` events do not carry `previous_item_id`.
  previousItemId: string | null;
};

/**
 * OpenAI Realtime streaming STT Transcriber
 *
 * Streams live transcript deltas over a WebRTC data channel while the user
 * speaks, then sends exactly one `input_audio_buffer.commit` at stop to get the
 * authoritative final transcript.
 *
 * The session is bootstrapped by the consumer-supplied `bootstrap` function, so
 * no credential ever lives in this package.
 */
class OpenAIRealtimeSTTTranscriber implements STTTranscriber {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  // Keyed by `item_id`. Map iteration is ARRIVAL order and must not be treated
  // as transcript order; conversation order comes from `orderedItems()`.
  private items = new Map<string, ItemRecord>();
  // The stop target: the item named by the first `input_audio_buffer.committed`
  // that arrives after our stop commit.
  private committedItemId: string | null = null;
  private awaitingStopCommit = false;
  // Session epoch. Every per-session callback captures the value from its
  // startRecording() call and ignores events once cleanup() has bumped it, so
  // listeners still attached to a closing pc/dc cannot mutate a newer session.
  private generation = 0;
  private connecting = false;
  private recording = false;
  private stopPending = false;
  private isCleaningUp = false;
  private channelOpen = false;
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
  private partialSubscribers: Array<(transcription: string) => void> = [];
  private readonly handlePageHide = () => this.cleanup();

  constructor(private config: OpenAIRealtimeSTTTranscriberConfig) {}

  /**
   * Open the realtime transcription session and start streaming microphone audio
   */
  async startRecording(options?: STTOptions): Promise<void> {
    if (this.recording || this.connecting) {
      throw new CharivoStateError("already recording");
    }

    this.connecting = true;
    this.items = new Map();
    this.committedItemId = null;
    this.awaitingStopCommit = false;
    this.stopPending = false;
    this.channelOpen = false;
    this.terminalError = null;
    this.setupError = null;
    this.pendingStop = null;
    const gen = ++this.generation;

    // Lets a mid-setup peer/channel failure reject the in-flight setup step
    // instead of hanging until a timeout.
    const setupFailure = new Promise<never>((_, reject) => {
      this.setupReject = reject;
    });
    // Pre-attach a no-op handler so this never-awaited promise cannot surface
    // as an `unhandledrejection` when no race arm is pending.
    void setupFailure.catch(() => {});

    try {
      this.pc = new RTCPeerConnection();

      this.pc.addEventListener("connectionstatechange", () => {
        if (gen !== this.generation || this.isCleaningUp) {
          return;
        }
        if (this.pc?.connectionState === "failed") {
          this.failOpenOrTerminal(
            new CharivoProviderError("connection failed"),
          );
        }
      });
      this.pc.addEventListener("iceconnectionstatechange", () => {
        if (gen !== this.generation || this.isCleaningUp) {
          return;
        }
        if (this.pc?.iceConnectionState === "failed") {
          this.failOpenOrTerminal(
            new CharivoProviderError("connection failed"),
          );
        }
      });

      const micPromise = this.acquireMic();
      // A getUserMedia() permission prompt can resolve after this attempt's
      // setup was canceled or superseded by a newer session; release that
      // late stream instead of leaking a hot mic nothing holds a reference
      // to. Handled separately from the race below, which only decides
      // whether THIS attempt proceeds.
      void micPromise.then(
        (stream) => {
          if (gen !== this.generation) {
            stream.getTracks().forEach((track) => track.stop());
          }
        },
        () => {},
      );
      this.mediaStream = await Promise.race([micPromise, setupFailure]);
      this.pc.addTrack(this.mediaStream.getTracks()[0], this.mediaStream);

      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.onmessage = (event: MessageEvent<string>) => {
        if (gen !== this.generation) {
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          this.failTerminal(
            new CharivoProviderError("malformed realtime event"),
          );
          return;
        }
        if (
          typeof payload !== "object" ||
          payload === null ||
          typeof (payload as { type?: unknown }).type !== "string"
        ) {
          this.failTerminal(new CharivoProviderError("invalid realtime event"));
          return;
        }
        this.handleServerEvent(payload as ServerEvent);
      };
      this.dc.onerror = () => {
        if (gen !== this.generation || this.isCleaningUp) {
          return;
        }
        this.failOpenOrTerminal(new CharivoProviderError("data channel error"));
      };
      this.dc.onclose = () => {
        if (gen !== this.generation || this.isCleaningUp) {
          return;
        }
        this.failOpenOrTerminal(
          new CharivoProviderError("data channel closed"),
        );
      };
      this.dc.onopen = () => {
        if (gen !== this.generation) {
          return;
        }
        this.channelOpen = true;
        this.resolveOpenGate();
      };

      const offer = await Promise.race([this.pc.createOffer(), setupFailure]);
      await Promise.race([this.pc.setLocalDescription(offer), setupFailure]);

      const { answerSdp } = await this.raceBootstrap(
        this.config.bootstrap({
          sdpOffer: offer.sdp!,
          session: { model: TRANSCRIPTION_MODEL, language: options?.language },
        }),
        setupFailure,
      );

      await Promise.race([
        this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp }),
        setupFailure,
      ]);
      await Promise.race([this.waitForChannelOpen(gen), setupFailure]);

      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", this.handlePageHide);
      }

      // Deltas stream live as audio is appended; nothing is committed until stop.
      this.recording = true;
    } catch (error) {
      const failure = this.setupError ?? error;
      this.cleanup();
      this.terminalError = null;
      this.setupError = null;
      throw failure;
    } finally {
      this.connecting = false;
      this.setupReject = null;
    }
  }

  /**
   * Commit the buffered audio and resolve with the authoritative transcript
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
      // isRecording() === true while connecting, from surfacing a thrown
      // error for what is, from the caller's perspective, a clean teardown.
      this.cancelConnecting();
      return "";
    }
    if (!this.recording) {
      return "";
    }

    this.stopPending = true;
    // Stop capturing NEW audio on stop entry so the single commit below
    // finalizes only already-buffered audio.
    this.setMicEnabled(false);

    return new Promise<string>((resolve, reject) => {
      this.pendingStop = { resolve, reject };
      // Discard any pre-stop server-segmented commit; the stop target must be
      // the item named by OUR commit.
      this.committedItemId = null;
      this.awaitingStopCommit = true;
      this.stopTimer = setTimeout(
        () =>
          this.rejectPendingStop(
            new CharivoTimeoutError(
              `stop timed out after ${COMMIT_TIMEOUT_MS}ms waiting for the final transcript`,
            ),
          ),
        COMMIT_TIMEOUT_MS,
      );
      this.sendCommit();
      // No-op until our own commit is acked; guards a synchronous ack.
      this.maybeResolveStop();
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
    bootstrapPromise: Promise<OpenAIRealtimeTranscriptionBootstrap>,
    setupFailure: Promise<never>,
  ): Promise<OpenAIRealtimeTranscriptionBootstrap> {
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

  private async waitForChannelOpen(gen: number): Promise<void> {
    if (this.channelOpen || this.dc?.readyState === "open") {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.openGate = { resolve, reject, settled: false };
      this.openTimer = setTimeout(() => {
        if (gen !== this.generation) {
          return;
        }
        this.rejectOpenGate(
          new CharivoTimeoutError(
            `streaming STT data channel did not open within ${OPEN_TIMEOUT_MS}ms`,
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

  // Cancels the in-flight startRecording(). Runs cleanup() synchronously so
  // a caller awaiting stopRecording() sees every acquired resource (mic, dc,
  // pc, timers, pagehide listener) already released by the time it returns,
  // then rejects whichever setup step startRecording() is currently
  // awaiting so ITS promise settles too, instead of hanging or going live.
  private cancelConnecting(): void {
    const error = new CharivoStateError(
      "start canceled because stop was called while connecting",
    );
    this.setupError ??= error;
    this.cleanup();
    this.setupReject?.(error);
  }

  private sendCommit(): void {
    try {
      this.dc!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch (error) {
      this.failTerminal(
        error instanceof Error
          ? error
          : new CharivoProviderError("failed to send commit"),
      );
    }
  }

  private ensureItem(id: string): ItemRecord {
    let record = this.items.get(id);
    if (!record) {
      record = {
        deltas: "",
        transcript: null,
        completed: false,
        previousItemId: null,
      };
      this.items.set(id, record);
    }
    return record;
  }

  private handleServerEvent(payload: ServerEvent): void {
    switch (payload.type) {
      case "conversation.item.input_audio_transcription.delta": {
        if (
          typeof payload.item_id !== "string" ||
          typeof payload.delta !== "string"
        ) {
          this.failTerminal(new CharivoProviderError("malformed delta event"));
          return;
        }
        const record = this.ensureItem(payload.item_id);
        record.deltas += payload.delta;
        this.emitPartial();
        return;
      }
      case "conversation.item.input_audio_transcription.completed": {
        if (
          typeof payload.item_id !== "string" ||
          typeof payload.transcript !== "string"
        ) {
          this.failTerminal(
            new CharivoProviderError("malformed completed event"),
          );
          return;
        }
        const record = this.ensureItem(payload.item_id);
        record.transcript = payload.transcript;
        record.completed = true;
        this.emitPartial();
        this.maybeResolveStop();
        return;
      }
      case "conversation.item.input_audio_transcription.failed": {
        if (typeof payload.item_id !== "string") {
          this.failTerminal(new CharivoProviderError("malformed failed event"));
          return;
        }
        const message = this.errorMessage(payload.error);
        if (message === null) {
          this.failTerminal(new CharivoProviderError("malformed failed event"));
          return;
        }
        this.failTerminal(new CharivoProviderError(message));
        return;
      }
      case "input_audio_buffer.committed": {
        if (typeof payload.item_id !== "string") {
          this.failTerminal(
            new CharivoProviderError("malformed committed event"),
          );
          return;
        }
        if (
          payload.previous_item_id !== undefined &&
          payload.previous_item_id !== null &&
          typeof payload.previous_item_id !== "string"
        ) {
          this.failTerminal(
            new CharivoProviderError("malformed committed event"),
          );
          return;
        }
        const record = this.ensureItem(payload.item_id);
        record.previousItemId =
          typeof payload.previous_item_id === "string"
            ? payload.previous_item_id
            : null;
        if (this.awaitingStopCommit) {
          this.committedItemId = payload.item_id;
          this.awaitingStopCommit = false;
        }
        this.maybeResolveStop();
        return;
      }
      case "error": {
        const message = this.errorMessage(payload.error);
        if (message === null) {
          this.failTerminal(new CharivoProviderError("malformed error event"));
          return;
        }
        this.failTerminal(new CharivoProviderError(message));
        return;
      }
      default:
        return;
    }
  }

  /**
   * Rebuild conversation order from the `previousItemId` linked-list, because
   * cross-item `completed` events can arrive out of order.
   */
  private orderedItems(): ItemRecord[] {
    const ids = new Set(this.items.keys());
    const next = new Map<string, string>();
    let headId: string | null = null;
    for (const [id, record] of this.items) {
      if (record.previousItemId === null || !ids.has(record.previousItemId)) {
        headId ??= id;
      } else {
        next.set(record.previousItemId, id);
      }
    }

    const ordered: ItemRecord[] = [];
    const seen = new Set<string>();
    for (
      let cur = headId;
      cur !== null && this.items.has(cur) && !seen.has(cur);
      cur = next.get(cur) ?? null
    ) {
      seen.add(cur);
      ordered.push(this.items.get(cur)!);
    }
    // Items with a genuinely missing `previous_item_id` degrade gracefully to
    // arrival order; this is not a claim that arrival == transcript order.
    for (const [id, record] of this.items) {
      if (!seen.has(id)) {
        ordered.push(record);
      }
    }
    return ordered;
  }

  private emitPartial(): void {
    const snapshot = this.buildSnapshot();
    for (const callback of this.partialSubscribers) {
      callback(snapshot);
    }
  }

  // Each delta carries its own spacing, so a plain "" join reconstructs the text.
  private buildSnapshot(): string {
    return this.orderedItems()
      .map((record) => record.transcript ?? record.deltas)
      .join("");
  }

  private buildFinal(): string {
    return this.orderedItems()
      .filter((record) => record.transcript !== null)
      .map((record) => record.transcript as string)
      .join("")
      .trim();
  }

  private failTerminal(error: Error): void {
    if (this.terminalError) {
      return;
    }
    this.terminalError = error;
    this.cleanup();
  }

  private errorMessage(error: unknown): string | null {
    return typeof error === "object" &&
      error !== null &&
      typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : null;
  }

  private maybeResolveStop(): void {
    if (!this.stopPending || !this.pendingStop) {
      return;
    }
    if (!this.committedItemId) {
      return;
    }
    const committed = this.items.get(this.committedItemId);
    if (!committed || !committed.completed) {
      return;
    }
    // "Earlier" means conversation order (previousItemId), not arrival order.
    for (const record of this.orderedItems()) {
      if (record === committed) {
        break;
      }
      if (!record.completed) {
        return;
      }
    }
    this.resolvePendingStop(this.buildFinal());
  }

  private setMicEnabled(enabled: boolean): void {
    this.mediaStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
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
      this.mediaStream?.getTracks().forEach((track) => track.stop());
      this.dc?.close();
      this.pc?.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", this.handlePageHide);
      }
      this.pc = null;
      this.dc = null;
      this.mediaStream = null;
      this.recording = false;
      this.connecting = false;
      this.stopPending = false;
      this.channelOpen = false;
      this.awaitingStopCommit = false;
      // Invalidate every callback still bound to the torn-down session.
      this.generation++;
    } finally {
      this.isCleaningUp = false;
    }
  }
}

export function createOpenAIRealtimeSTTTranscriber(
  config: OpenAIRealtimeSTTTranscriberConfig,
): STTTranscriber {
  return new OpenAIRealtimeSTTTranscriber(config);
}
