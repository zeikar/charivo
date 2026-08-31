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
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRealtimeSessionBootstrap,
} from "../internal/shared";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import { DEFAULT_GEMINI_LIVE_MODEL } from "./defaults";

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

      // Task 5 wires ensurePlaybackReady() in here, before the socket opens.
      // It must also be reachable from `prepareAudio()`, which is where the
      // user gesture actually is: this call site alone would create the
      // AudioContext outside one, which is the failure the surviving-context
      // handling below exists to avoid.
      // Task 6 wires the microphone capture pipeline in beside it.

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
      this.resolvePendingConnect();
      return;
    }

    // Task 7 maps serverContent / toolCall / usageMetadata from here.
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
    this.rejectPendingConnect(
      new Error("Gemini Live session ended before setup completed"),
    );
    this.lipSyncAnalyzer.pause();

    // Task 5 flushes the playback scheduler here (the context itself stays).
    // Task 6 stops microphone capture here — it is per-session and rebuilt on
    // every connect(), unlike the prepared playback context.
    // Task 7 clears per-turn state and re-arms the convergence gate with a
    // zeroed exposure accumulator.
    // Task 8 clears the tool-call map: call IDs are session-scoped.
    //
    // Nothing here unbinds browser-lifecycle listeners because this client
    // binds none yet. Half of what `bindTransportLifecycle` gives the OpenAI
    // client is already covered: a websocket reports a dead connection through
    // its own `onclose`, where WebRTC needed ICE state watched. The other half
    // has no websocket equivalent — pausing and resuming the analyzer across
    // visibility/pagehide (Task 5) and refreshing the microphone on
    // `devicechange` (Task 6) — and is still missing.
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

    // Task 5 closes the playback AudioContext and nulls the scheduler here.

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
