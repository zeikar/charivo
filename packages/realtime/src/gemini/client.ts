import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  CharivoProviderError,
  CharivoStateError,
  createLipSyncAnalyzer,
  fetchWithTimeout,
  GEMINI_LIVE_ADAPTER,
} from "@charivo/core";
import { acquireMicrophoneStream } from "../internal/microphone";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRealtimeSessionBootstrap,
} from "../internal/shared";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import type { CapturePipeline } from "./capture";
import { createCapturePipeline } from "./capture";
import {
  CONVERGENCE_GATE_MS,
  DEFAULT_GEMINI_LIVE_MODEL,
  INPUT_SAMPLE_RATE,
  OUTPUT_SAMPLE_RATE,
} from "./defaults";
import { createPlaybackGraph, PlaybackScheduler } from "./playback";

export interface GeminiLiveClientOptions {
  apiEndpoint?: string;
  debug?: boolean;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
}

/** Top-level server frame. Task 7 adds `serverContent`, `toolCall`, and the rest. */
interface GeminiServerMessage {
  setupComplete?: Record<string, unknown>;
}

/**
 * A socket plus the generation it belongs to. Every handler closes over its own
 * binding, so a transient reset — which bumps the epoch — turns every late
 * callback from the replaced socket into a no-op.
 */
interface GeminiSocketBinding {
  socket: WebSocket;
  epoch: number;
  /**
   * Per-socket serialized message pump. Chaining keeps mixed string/`Blob`
   * payloads in arrival order, and giving each socket its own chain means a
   * reconnect abandons the old one instead of queueing behind it.
   */
  pump: Promise<void>;
}

interface PendingConnect {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Gemini Live WebSocket transport client.
 *
 * This package normalizes Gemini Live bidi-generate-content frames into the
 * transport event contract defined by `@charivo/realtime`.
 */
export class GeminiLiveClient implements RealtimeTransportClient {
  private activeSocket: GeminiSocketBinding | null = null;
  /** Bumped by every transient reset; see `GeminiSocketBinding`. */
  private socketEpoch = 0;
  private pendingConnect: PendingConnect | null = null;
  private readonly lipSyncAnalyzer = createLipSyncAnalyzer({
    onRms: (rms) => this.emitEvent({ type: "audio.lipsync", rms }),
    onError: (error) => console.error("Failed to setup audio analysis:", error),
  });
  /**
   * Created once, inside a user gesture, and reused for the client's whole
   * life. Only the terminal `cleanup()` closes it.
   */
  private playbackContext: AudioContext | null = null;
  private playbackScheduler: PlaybackScheduler | null = null;
  /**
   * Per-session, unlike the playback context above: both the stream and the
   * pipeline reading it are acquired by every `connect()` and dropped by the
   * transient reset.
   */
  private captureStream: MediaStream | null = null;
  private capturePipeline: CapturePipeline | null = null;
  /**
   * Whether the server has acknowledged setup. Microphone frames wait on it —
   * see `sendCaptureFrame`.
   */
  private isSetupComplete = false;
  /**
   * Convergence gate. Safari's echo canceller leaks the character's own voice
   * for roughly the first half-second after it starts speaking, and converges
   * cumulatively across turns (measured,
   * `tests/gemini-live-smoke/README.md`), so while armed the client drops the
   * microphone frames landing within `CONVERGENCE_GATE_MS` of playback becoming
   * audible.
   *
   * Dropping them does not slow that adaptation down: the canceller runs inside
   * the `getUserMedia` pipeline and adapts to whatever plays out, forwarded or
   * not. The gate only keeps the not-yet-converged residue from reaching the
   * model, at a bounded cost — a barge-in inside the gate window at the start
   * of a reply is lost, against the character killing its own turn twice.
   *
   * Task 7 owns the disarm rule, by accumulated audible exposure.
   */
  private gateArmed = true;
  /**
   * `performance.now()` at the moment the current turn's playback became
   * audible, and the only thing the gate window is measured from: a fact this
   * client owns, never a guess about what the microphone contains. Recorded per
   * turn by Task 7; read by `sendCaptureFrame` and cleared by the transient
   * reset.
   */
  private playbackAudibleSince: number | null = null;
  private currentSessionConfig?: RealtimeSessionConfig;
  private connectionLossNotified = false;
  private isExplicitDisconnect = false;
  private isRecovering = false;
  /**
   * Set only for the span of the terminal `cleanup()`. It is what stops a
   * teardown step from reporting the session it is dismantling as lost — most
   * visibly on a failed initial connect, where the manager would hear
   * `connection.lost` for a session that never started.
   */
  private isCleaningUp = false;
  private eventCallbacks = new Set<(event: RealtimeTransportEvent) => void>();

  constructor(private options: GeminiLiveClientOptions = {}) {}

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    try {
      if (this.isExplicitDisconnect && this.isRecovering) {
        throw new Error("Realtime session disconnect requested");
      }

      this.log("Starting Gemini Live websocket connection");

      this.isExplicitDisconnect = false;
      this.currentSessionConfig = config;

      // Always a fresh bootstrap, on a reconnect too: ephemeral tokens are
      // minted `uses: 1` and replaying one closes the socket with 1011.
      const bootstrap = await this.getSessionBootstrap({
        transport: "websocket",
        session: config ?? {},
      });
      const { url, token } = resolveWebSocketBootstrap(bootstrap);

      // A disconnect() that landed while the bootstrap was in flight: honour it
      // instead of opening a socket nobody is listening to.
      if (this.isExplicitDisconnect) {
        throw new Error("Realtime session disconnect requested");
      }

      // Reuses whatever `prepareAudio()` warmed up, which is where the user
      // gesture actually is. Only a caller that skipped `prepareAudio()`
      // creates the AudioContext here, outside a gesture — the case the
      // surviving-context handling below keeps from repeating on every
      // reconnect.
      await this.ensurePlaybackReady();

      // Ahead of the socket, deliberately: `openSocket()` arms the setup
      // timeout the moment it opens, and a permission prompt left sitting would
      // burn it. Plain `echoCancellation: true` over the ordinary playback path
      // is what the Chrome control measured as sufficient — 14 self-
      // interruptions with cancellation off against 0 with it on
      // (`tests/gemini-live-smoke/README.md`).
      try {
        this.captureStream = await acquireMicrophoneStream();
      } catch (error) {
        // The message the OpenAI client already gives for a refused
        // microphone — one package should not answer the same question two
        // ways — with the original `DOMException` kept as `cause`, because
        // denial and no-such-device are different repairs.
        throw new Error("Microphone access required for Realtime API", {
          cause: error,
        });
      }

      // The prompt above is the widest window in connect() for a disconnect()
      // to land in; the throw hands the stream to the teardown below.
      if (this.isExplicitDisconnect) {
        throw new Error("Realtime session disconnect requested");
      }

      const capturePipeline = await createCapturePipeline({
        stream: this.captureStream,
        onFrame: (frame) => this.sendCaptureFrame(frame),
      });

      // Assigned only once it is this client's to tear down. A disconnect()
      // landing inside the await above already ran the teardown, which found a
      // null field and stopped nothing, so an unconditional assignment would
      // strand a live `AudioContext` that no later reset can reach.
      if (this.isExplicitDisconnect) {
        capturePipeline.stop();
        throw new Error("Realtime session disconnect requested");
      }
      this.capturePipeline = capturePipeline;

      await this.openSocket(url, token, config?.model);

      this.connectionLossNotified = false;
      this.emitEvent({ type: "session.started" });
    } catch (error) {
      // Terminal on an initial connect; transient while recovering, so the
      // gesture-warmed playback context survives the reconnect attempt.
      if (this.isRecovering) {
        this.resetTransportState();
      } else {
        this.cleanup();
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting Gemini Live websocket");
    this.isExplicitDisconnect = true;
    this.isRecovering = false;
    this.cleanup();
  }

  async updateSession(_config?: RealtimeSessionConfig): Promise<void> {
    // The Live API has no mid-session equivalent of `session.update`: the
    // ephemeral token's `bidiGenerateContentSetup` fixes the whole session at
    // mint time. Reject rather than silently drop the caller's change.
    throw new Error(
      "updateSession() is not supported on an open Gemini Live session. Reconnect with the new configuration instead.",
    );
  }

  async recover(config?: RealtimeSessionConfig): Promise<void> {
    this.isRecovering = true;
    this.connectionLossNotified = true;
    this.currentSessionConfig = config ?? this.currentSessionConfig;

    try {
      // Transient only. `connect()` reuses the prepared playback context rather
      // than creating and resuming a replacement outside any user gesture.
      this.resetTransportState();
      await this.connect(this.currentSessionConfig);
    } finally {
      this.isRecovering = false;
    }
  }

  // Tasks 7-8 replace the bodies of sendText(), interrupt(), and
  // sendToolResult() with the real client frames. Until then they refuse rather
  // than accept input the socket will never carry. sendAudio() below is not one
  // of them: its no-op is the final behavior.
  async sendText(_text: string): Promise<void> {
    throw new Error("Gemini Live transport is not ready to send text");
  }

  async interrupt(): Promise<void> {
    throw new Error("Gemini Live transport is not ready to interrupt");
  }

  async sendToolResult(
    _callId: string,
    _output: Record<string, unknown>,
  ): Promise<void> {
    throw new Error("Gemini Live transport is not ready to send tool results");
  }

  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    console.warn(
      "sendAudio is not needed with the Gemini Live transport - the microphone is captured internally",
    );
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
  }

  async prepareAudio(): Promise<void> {
    await this.ensurePlaybackReady();
  }

  /**
   * Build the playback context, graph, scheduler, and lip-sync analyzer once,
   * and afterwards only nudge that same playback context back towards running.
   * It does not promise a running context on return; see the resume below.
   *
   * Both `prepareAudio()` and `connect()` come here, and the order they arrive
   * in is the point: whichever runs first builds everything, the other reuses
   * it. That is what keeps the `AudioContext` the one created inside a user
   * gesture instead of a replacement built during an automatic reconnect,
   * which the browser would refuse to start.
   *
   * The playback context is the only one this covers, and that leaves a gap
   * worth knowing about: `lipSyncAnalyzer.prepare()` creates a second
   * `AudioContext` of its own, and nothing in `@charivo/core` ever resumes it.
   * A suspended `AnalyserNode` returns all-zero frequency data, so in exactly
   * the case the nudge below exists for — a caller that skipped
   * `prepareAudio()` — lip sync reads flat and no error surfaces anywhere.
   * Pre-existing and identical in `openai/client.ts`; closing it means changing
   * the analyzer contract, not this file.
   */
  private async ensurePlaybackReady(): Promise<void> {
    const existing = this.playbackContext;
    if (existing) {
      // Deliberately not awaited. On a document that has never been interacted
      // with, `resume()` parks its promise rather than settling it — the spec
      // appends it to [[pending resume promises]] and aborts — which would hang
      // connect() at a point where no socket, and so no setup timeout, is armed
      // yet. A context that stays suspended only delays audio; a connect() that
      // never settles wedges the session with no error and no way back.
      //
      // Anything other than "running" is retried because WebKit also has a
      // non-standard "interrupted" state, which a "suspended" check alone would
      // leave stopped for good.
      if (existing.state !== "running") {
        void existing
          .resume()
          .catch((error) =>
            console.error(
              "Failed to resume the playback audio context:",
              error,
            ),
          );
      }
      return;
    }

    const context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    const graph = createPlaybackGraph(context);

    // Assigned before the first await, so a second call cannot slip past the
    // null check above and build a rival context.
    this.playbackContext = context;
    this.playbackScheduler = new PlaybackScheduler(context, graph.output, {
      // Task 7 combines this with `turnComplete` to decide that audio ended —
      // a drain on its own fires 3 ms into a twelve-second reply.
      onDrain: () => {},
      // Task 7 records `playbackAudibleSince` at the turn's *first* audible
      // playback, and sums these intervals into the exposure total that
      // disarms the gate. Not once per audible span: this fires again on every
      // mid-turn underrun, so re-anchoring on it would let a stalling
      // connection hold the gate open for a whole reply — silently, which is
      // the failure class the measured record already warns about. Once
      // anchored, leave it standing when playback stops; the window has to
      // expire on its own clock rather than on silence the acoustic path has
      // not caught up with. Task 7 also resumes/pauses the analyzer here.
      onPlayingChange: (_playing: boolean) => {},
    });

    await this.lipSyncAnalyzer.prepare();
    // The tap is stable for the client's whole life, unlike the OpenAI client's
    // per-connection remote track, so this attaches once. Attaching starts the
    // analysis loop, so pause it until audio actually plays.
    this.lipSyncAnalyzer.attachMediaStream(graph.lipSyncStream);
    this.lipSyncAnalyzer.pause();
  }

  private openSocket(
    url: string,
    token: string,
    model?: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let socket: WebSocket;
      try {
        // The endpoint accepts the ephemeral token only as a query parameter,
        // so the built URL is a credential: it never reaches log(), an error
        // message, or an event payload. A constructor failure is re-thrown as
        // a bare message for the same reason — the native one quotes the URL.
        socket = new WebSocket(
          `${url}?access_token=${encodeURIComponent(token)}`,
        );
      } catch {
        reject(new Error("Failed to open the Gemini Live websocket"));
        return;
      }

      const binding: GeminiSocketBinding = {
        socket,
        epoch: this.socketEpoch,
        pump: Promise.resolve(),
      };
      this.activeSocket = binding;

      this.pendingConnect = {
        resolve,
        reject,
        timeoutId: setTimeout(() => {
          this.rejectPendingConnect(
            new Error(
              `Gemini Live session setup timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
            ),
          );
        }, DEFAULT_REQUEST_TIMEOUT_MS),
      };

      socket.onopen = () => {
        // Only the model: the token's `bidiGenerateContentSetup` replaces this
        // frame wholesale rather than merging with it (measured), so anything
        // else sent here is discarded.
        this.log("Gemini Live websocket open — sending setup");
        socket.send(
          JSON.stringify({
            setup: { model: `models/${model ?? DEFAULT_GEMINI_LIVE_MODEL}` },
          }),
        );
      };

      socket.onmessage = (event: MessageEvent) => {
        this.enqueueServerMessage(binding, event.data);
      };

      socket.onerror = () => {
        this.failTransport(binding, new Error("Gemini Live websocket error"));
      };

      socket.onclose = (event: CloseEvent) => {
        // The close code and the server's reason are diagnostics, not secrets.
        this.log(
          `Gemini Live websocket closed code=${event.code} reason="${event.reason}" clean=${event.wasClean}`,
        );
        this.failTransport(
          binding,
          new Error(
            `Gemini Live websocket closed (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`,
          ),
        );
      };
    });
  }

  private enqueueServerMessage(
    binding: GeminiSocketBinding,
    data: string | Blob,
  ): void {
    if (binding.epoch !== this.socketEpoch) {
      return;
    }

    binding.pump = binding.pump
      .then(async () => {
        const raw = typeof data === "string" ? data : await data.text();

        // Re-checked after the await, not only at enqueue: a `Blob.text()` can
        // resolve long after a transient reset swapped the socket, and applying
        // it then would mutate a session this payload never belonged to.
        if (binding.epoch !== this.socketEpoch) {
          return;
        }

        this.applyServerMessage(JSON.parse(raw) as GeminiServerMessage);
      })
      .catch((error: unknown) => {
        // Protocol-fatal, never recoverable in place: a dropped frame corrupts
        // session state while the socket still looks healthy. The underlying
        // error travels as `cause` rather than in the message, because a JSON
        // parse failure quotes a window of the offending frame, frames carry
        // session resumption handles, and this error reaches manager state that
        // app code renders.
        this.failTransport(
          binding,
          new Error("Failed to handle a Gemini Live message", { cause: error }),
        );
      });
  }

  private applyServerMessage(message: GeminiServerMessage): void {
    if (message.setupComplete) {
      this.log("Gemini Live setup complete");
      this.isSetupComplete = true;
      this.resolvePendingConnect();
      return;
    }

    // Task 7 maps serverContent / toolCall / usageMetadata from here.
  }

  /**
   * The only path microphone audio takes to the wire.
   *
   * Frames are dropped rather than queued whenever they cannot be sent now:
   * before `setupComplete` the session does not exist yet to receive them, and
   * a frame held across a reconnect is audio the user spoke into a session that
   * has ended.
   */
  private sendCaptureFrame(frame: Uint8Array): void {
    const socket = this.activeSocket?.socket;
    if (
      !socket ||
      !this.isSetupComplete ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (this.isWithinConvergenceGate()) {
      return;
    }

    socket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: bytesToBase64(frame),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        },
      }),
    );
  }

  /**
   * Whether this moment falls inside the convergence gate: still armed, and
   * within `CONVERGENCE_GATE_MS` of the current turn's playback becoming
   * audible. Task 7 disarms the gate by accumulated audible exposure.
   */
  private isWithinConvergenceGate(): boolean {
    return (
      this.gateArmed &&
      this.playbackAudibleSince !== null &&
      performance.now() - this.playbackAudibleSince < CONVERGENCE_GATE_MS
    );
  }

  /**
   * The single settlement point for every way a socket can fail.
   *
   * Before `setupComplete` the pending `connect()` owns the failure and settles
   * immediately — during the initial connect nothing is listening for
   * `connection.lost`, so waiting out the timeout would hang the caller, and
   * `connect()`'s catch runs the teardown at the depth the situation calls for.
   * After setup, the transient reset runs first so `recover()` starts from a
   * clean session, and the loss is reported once.
   */
  private failTransport(binding: GeminiSocketBinding, error: Error): void {
    if (binding.epoch !== this.socketEpoch) {
      return;
    }

    if (this.pendingConnect) {
      this.rejectPendingConnect(error);
      return;
    }

    this.resetTransportState();
    this.emitConnectionLost(error);
  }

  /**
   * Transient teardown: everything belonging to one websocket session, and
   * nothing belonging to the user gesture. The prepared playback context and
   * the lip-sync analyzer deliberately survive, so an automatic reconnect does
   * not have to create and resume an `AudioContext` outside a user gesture.
   */
  private resetTransportState(): void {
    // Bumped first: it orphans every handler and queued pump payload still
    // holding the outgoing socket's epoch.
    this.socketEpoch += 1;
    this.closeActiveSocket();
    this.isSetupComplete = false;
    this.rejectPendingConnect(
      new Error("Gemini Live session ended before setup completed"),
    );
    this.lipSyncAnalyzer.pause();
    // Only what was scheduled: the context, graph, and scheduler stay, because
    // they belong to the gesture rather than to the socket.
    this.playbackScheduler?.flush();

    // Capture goes the other way: it is rebuilt on every connect(), and the
    // tracks are stopped so the browser's recording indicator clears.
    this.capturePipeline?.stop();
    this.capturePipeline = null;
    this.captureStream?.getTracks().forEach((track) => track.stop());
    this.captureStream = null;
    // Re-armed with the stream it gates: whatever the canceller had adapted to
    // belonged to the `getUserMedia` stream just stopped, so its replacement
    // starts unadapted. Gating again costs at most one more bounded window;
    // assuming the adaptation survived would cost whole turns.
    this.gateArmed = true;
    this.playbackAudibleSince = null;

    // Task 7 clears per-turn state and zeroes the exposure accumulator its
    // gate-disarm rule sums into.
    // Task 8 clears the tool-call map: call IDs are session-scoped.
    //
    // Nothing here unbinds browser-lifecycle listeners because this client
    // binds none yet. Half of what `bindTransportLifecycle` gives the OpenAI
    // client is already covered: a websocket reports a dead connection through
    // its own `onclose`, where WebRTC needed ICE state watched. The other half
    // has no websocket equivalent and is still missing: pausing and resuming
    // the analyzer across visibility/pagehide — a real gap now that a playback
    // tap is attached to it, not a pending wiring step — and refreshing the
    // microphone on `devicechange`, equally real now that capture is wired.
    // `replaceMicrophoneTrack` has no counterpart here because there is no
    // sender to swap a track into, so following a device change would mean
    // rebuilding the capture pipeline around a fresh stream mid-session.
  }

  /**
   * Terminal teardown: the transient reset plus everything the user gesture
   * warmed up. Only an explicit `disconnect()` and a failed initial `connect()`
   * come here; every recovery path takes the transient reset instead.
   */
  private cleanup(): void {
    this.isCleaningUp = true;
    this.resetTransportState();
    this.lipSyncAnalyzer
      .cleanup()
      .catch((error) =>
        console.error("Failed to clean up lip-sync analyzer:", error),
      );

    // The transient reset above already flushed the scheduler; this is the only
    // place the gesture-warmed context is given up. Nulled before the close
    // settles so a `prepareAudio()` racing it builds a fresh one instead of
    // reusing the closing one.
    const playbackContext = this.playbackContext;
    this.playbackContext = null;
    this.playbackScheduler = null;
    playbackContext
      ?.close()
      .catch((error) =>
        console.error("Failed to close the playback audio context:", error),
      );

    this.connectionLossNotified = false;
    this.isCleaningUp = false;
  }

  private closeActiveSocket(): void {
    const binding = this.activeSocket;
    this.activeSocket = null;
    if (!binding) {
      return;
    }

    // Detached before closing so our own teardown does not re-enter
    // failTransport through onclose.
    binding.socket.onopen = null;
    binding.socket.onmessage = null;
    binding.socket.onerror = null;
    binding.socket.onclose = null;

    // Unconditional: closing an already-closing or closed socket is a no-op.
    binding.socket.close();
  }

  private emitConnectionLost(error: Error): void {
    if (
      this.connectionLossNotified ||
      this.isExplicitDisconnect ||
      this.isCleaningUp
    ) {
      return;
    }

    this.connectionLossNotified = true;
    // Every unexpected websocket end maps to the one existing cause this cycle;
    // a Gemini-specific `RealtimeReconnectCause` is a cycle-2 decision.
    this.emitEvent({
      type: "connection.lost",
      cause: "connection-failed",
      error,
    });
  }

  private resolvePendingConnect(): void {
    const pending = this.pendingConnect;
    if (!pending) {
      return;
    }

    this.pendingConnect = null;
    clearTimeout(pending.timeoutId);
    pending.resolve();
  }

  private rejectPendingConnect(error: Error): void {
    const pending = this.pendingConnect;
    if (!pending) {
      return;
    }

    this.pendingConnect = null;
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  }

  private async getSessionBootstrap(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    if (this.options.sessionBootstrap) {
      return this.options.sessionBootstrap(request);
    }

    const apiEndpoint = this.options.apiEndpoint;
    if (!apiEndpoint) {
      throw new CharivoStateError(
        "Gemini Live client requires apiEndpoint or sessionBootstrap",
      );
    }

    const response = await fetchWithTimeout(
      apiEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
      {
        timeoutMessage: `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
        failureMessage: "Realtime request failed",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new CharivoProviderError(
        `Failed to create Realtime session: ${errorText}`,
      );
    }

    const bootstrap = (await response.json()) as unknown;
    if (!isRealtimeSessionBootstrap(bootstrap)) {
      throw new CharivoProviderError(
        "Invalid realtime session bootstrap response",
      );
    }

    return bootstrap;
  }

  private emitEvent(event: RealtimeTransportEvent): void {
    for (const callback of this.eventCallbacks) {
      callback(event);
    }
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log(...args);
    }
  }
}

/**
 * A generic helper whose only caller hands it one 640-byte capture frame, so
 * the loop runs a single time today. The chunking stays because the trap it
 * avoids is real and silent: `btoa` wants a binary string, and building one
 * with `String.fromCharCode(...bytes)` makes every byte an argument, which
 * throws once a payload outgrows the engine's argument limit.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

function resolveWebSocketBootstrap(bootstrap: RealtimeSessionBootstrap): {
  url: string;
  token: string;
} {
  if (
    bootstrap.adapter !== GEMINI_LIVE_ADAPTER ||
    bootstrap.transport !== "websocket"
  ) {
    throw new Error(
      `Gemini Live client only supports ${GEMINI_LIVE_ADAPTER} bootstrap, received ${bootstrap.adapter}/${bootstrap.transport}`,
    );
  }

  if (!bootstrap.url || !bootstrap.token) {
    throw new Error(
      "Gemini Live bootstrap is missing its websocket url or token",
    );
  }

  return { url: bootstrap.url, token: bootstrap.token };
}

export function createGeminiLiveClient(
  options?: GeminiLiveClientOptions,
): RealtimeTransportClient {
  return new GeminiLiveClient(options);
}
