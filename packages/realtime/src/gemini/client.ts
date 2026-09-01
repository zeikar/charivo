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

/** One `inlineData` part carries one `audio/pcm;rate=24000` chunk. */
interface GeminiPart {
  inlineData?: { data?: string; mimeType?: string };
}

/**
 * One entry of a `toolCall` frame. Optional throughout because this is parsed
 * wire data rather than anything this client constructs; `handleToolCall`
 * decides which absences it can survive.
 */
interface GeminiFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

/**
 * Top-level server frame. `setupComplete`, `serverContent`,
 * `sessionResumptionUpdate`, and `usageMetadata` were seen on a live session;
 * the tool and `goAway` shapes come from the API reference and are unverified
 * (`tests/gemini-live-smoke/README.md`).
 */
interface GeminiServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: { parts?: GeminiPart[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: GeminiFunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: Record<string, unknown>;
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
   * Disarmed by accumulated audible exposure, in `endAudioOutput`.
   */
  private gateArmed = true;
  /**
   * `performance.now()` at the moment the current turn's playback became
   * audible, and the only thing the gate window is measured from: a fact this
   * client owns, never a guess about what the microphone contains. Re-anchored
   * at every turn's first audible playback by `beginAudiblePlayback`; read by
   * `sendCaptureFrame` and cleared by the transient reset.
   */
  private playbackAudibleSince: number | null = null;
  /**
   * How much audible playback the echo canceller has had to adapt to, summed
   * over the scheduler's playing → not-playing intervals for the whole session
   * and the only quantity the gate disarms on. `audibleSpanStartedAt` is the
   * open interval, or null while nothing is sounding.
   */
  private audibleExposureMs = 0;
  private audibleSpanStartedAt: number | null = null;
  /**
   * Assistant-side turn state. Output transcription is native audio's only
   * source of assistant text, and both fields are cleared at `turnComplete`.
   */
  private hasStartedAssistantResponse = false;
  private assistantText = "";
  /**
   * Audio bookkeeping, which deliberately outlives `turnComplete`: in the
   * measured normal sequence the final drain lands ~3 ms *after* it, so both
   * are cleared where `audio.output.ended` actually fires.
   *
   * `hasStartedAudioOutput` is what keeps the pair balanced — every ending path
   * requires it and clears it, so a raw transport listener sees exactly one
   * start/end per turn. `turnCompleteSeen` means an ending is still owed, and
   * is the second half of `ended` = currently idle AND `turnComplete` seen. The
   * transient reset drops both, along with the turn they described.
   */
  private hasStartedAudioOutput = false;
  private turnCompleteSeen = false;
  /**
   * Whether server VAD killed this turn. Set by `handleInterrupted`, then read
   * and cleared by the `endAudioOutput` it goes on to call: an interrupted turn
   * banks its audible exposure like any other but never disarms the gate.
   */
  private turnInterrupted = false;
  /**
   * Whether the server has a model turn open — content has arrived and its
   * `turnComplete` has not. It is the only proof `interrupt()` accepts that
   * there is a turn to condemn, and neither existing flag answers that
   * question: `hasStartedAssistantResponse` follows output transcription, which
   * is a server-side session setting this client does not control, and the
   * audio flags deliberately outlive `turnComplete`.
   */
  private modelTurnInFlight = false;
  /**
   * Whether a local `interrupt()` killed the turn in flight. Nothing on the
   * wire stops the server generating it, so while this is set the rest of that
   * turn is dropped at the guard in `applyServerMessage`, which is where what
   * "the rest" covers is settled, and its completion is never reported:
   * `RealtimeTransportEvent` forbids reporting an interrupted turn once a
   * replacement may have started, because `RealtimeManager` would credit that
   * completion to the replacement and release its send lock.
   * `handleTurnComplete` is the single exit.
   *
   * A boolean where `openai/client.ts` learned to keep a count. That lesson
   * does not transfer: it can issue `response.create` itself and stack a
   * replacement behind a cancel, whereas turns here are the server's to open
   * and it opens them one at a time, so there is never more than one to
   * condemn.
   */
  private turnCondemned = false;
  /**
   * Live `functionCall.id` -> tool name, which `sendToolResult` needs because a
   * Gemini `functionResponse` carries the name alongside the id. An entry lives
   * from the `toolCall` frame until that call is answered or cancelled, and the
   * map as a whole belongs to the session: the transient reset drops it, so a
   * handler finishing after a reconnect throws instead of answering into a
   * session that never asked.
   */
  private readonly pendingToolCalls = new Map<string, string>();
  /**
   * Newest `usageMetadata` of the turn in progress, reported as `usage` when it
   * completes and dropped there. Nothing measured guarantees one frame per
   * turn, so carrying it forward would report the previous turn's numbers as
   * this one's — and since audio prompt tokens grow turn over turn, it would
   * under-report rather than fail visibly.
   */
  private latestUsage: Record<string, unknown> | undefined;
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

  async sendText(text: string): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    const socket = this.requireReadySocket();
    // `turnComplete: true` closes the user turn, which is what asks the model
    // to answer it. The condemned-turn state is deliberately untouched: sending
    // replacement input says nothing about whether a condemned turn has
    // finished arriving.
    socket.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      }),
    );
  }

  /**
   * Stop the character mid-sentence.
   *
   * Entirely local, and it has to be: the Live API documents no client message
   * that cancels an in-flight generation. So the turn is condemned instead,
   * which rests on the killed turn still running to its own `turnComplete` —
   * the single exit from condemnation. That was measured rather than assumed
   * (`tests/gemini-live-smoke/README.md`, Q2): interrupting mid-count emitted
   * no completion for the killed turn, and the very next turn completed
   * normally, which it could not have done had the condemnation never lifted.
   * What has been scheduled is discarded, and its remaining speech and
   * text are dropped — though not its tool calls, which `applyServerMessage`
   * still dispatches on purpose. Nothing goes on the wire, which is why this
   * needs neither an open socket nor a recovery guard.
   */
  async interrupt(): Promise<void> {
    // Condemn only a turn the wire proves is running, as in the OpenAI client:
    // condemning with nothing open would swallow the *next* turn's completion
    // and strand the manager's send lock for good.
    if (this.modelTurnInFlight) {
      this.turnCondemned = true;
      this.log("Gemini Live turn condemned by a local interrupt");
    }

    // Silencing what is already scheduled is separate, for the reason the
    // OpenAI client clears its output buffer unconditionally: playback outlives
    // the turn that produced it. `turnComplete` is paced to land as the audio
    // finishes, so on a healthy connection that overlap is the measured 3 ms of
    // post-`turnComplete` tail — but the server is pacing a clock, not watching
    // the speakers, and a stall widens it. An interrupt has to stop the voice
    // either way.
    //
    // `turnInterrupted` stays down on purpose: it marks a turn the model killed
    // after hearing itself through an unconverged canceller, and a local
    // interrupt is no evidence of that, so this turn's exposure still counts
    // towards disarming the gate.
    this.playbackScheduler?.flush();
    this.endAudioOutput();
  }

  async sendToolResult(
    callId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    // Resolved before the socket is asked for, so a dead id fails as a dead id.
    const name = this.pendingToolCalls.get(callId);
    if (!name) {
      throw new Error(
        `Unknown Gemini Live tool call "${callId}": it was already answered, cancelled by the server, or belongs to a session that has ended`,
      );
    }

    const socket = this.requireReadySocket();
    socket.send(
      JSON.stringify({
        toolResponse: {
          functionResponses: [{ id: callId, name, response: output }],
        },
      }),
    );
    // Dropped only once the answer is on the wire: a send that throws leaves
    // the call answerable rather than unknown.
    this.pendingToolCalls.delete(callId);
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
      onDrain: () => {
        // A drain on its own is not the end of the model's audio — see
        // `PlaybackSchedulerCallbacks.onDrain` for the measurement. Only a
        // drain that follows `turnComplete` ends the turn; every other one is
        // an underrun audio resumes from.
        if (this.turnCompleteSeen) {
          this.endAudioOutput();
        }
      },
      onPlayingChange: (playing: boolean) => {
        if (playing) {
          this.beginAudiblePlayback();
        } else {
          this.bankAudibleExposure();
        }
      },
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

    if (message.usageMetadata) {
      // Newest wins: it is what the turn reports as `usage` when it completes.
      this.latestUsage = message.usageMetadata;
    }

    // Above the `serverContent` guard below, deliberately: a tool frame carries
    // no `serverContent` at all, so handling it down there would drop every
    // tool call silently. That leaves it above the condemned-turn guard too,
    // which is a decision rather than an oversight — a condemned turn's tool
    // calls are still emitted, executed, and answered onto the wire, as the
    // sibling also leaves them (`openai/client.ts`). The exposure is larger
    // here, because this design expects a condemned turn to keep sending —
    // which it does; see `interrupt()`.
    if (message.toolCall) {
      this.handleToolCall(message.toolCall.functionCalls ?? []);
    }

    // The model gave up on these calls, so their ids are dead. Dropping them
    // here is what turns a handler that answers one late into a diagnosable
    // throw rather than a response the session cannot place.
    for (const id of message.toolCallCancellation?.ids ?? []) {
      this.pendingToolCalls.delete(id);
    }

    // `sessionResumptionUpdate` and `goAway` are read by nothing on purpose.
    // Handles arrive roughly every 1.2 s, each superseding the last (~50 per
    // 100 s session), and none of them can be spent here for the reason
    // `updateSession()` refuses: the session is fixed at mint time, so resuming
    // one would have to be minted server-side. They are session credentials
    // either way, so they are never logged. `goAway` announces a handover this
    // client cannot perform, and the close that follows it already drives
    // recovery.

    const content = message.serverContent;
    if (!content) {
      return;
    }

    // Emitted straight through, one event per message, with no accumulation
    // buffer and no turn-boundary flush: input transcription arrives finalized
    // per utterance, unlike output — two spoken utterances produced exactly two
    // complete-sentence events against 44 fragmentary output events in the same
    // session (measured). Accumulating would merge separate user turns.
    // `interimInputTranscription` is ignored entirely.
    if (content.inputTranscription?.text) {
      this.emitEvent({
        type: "user.transcript",
        text: content.inputTranscription.text,
      });
    }

    // Everything below belongs to the model, so a condemned turn stops here:
    // its audio, its transcription, and a late `interrupted` are dropped alike
    // until its own `turnComplete`, the single exit. The user transcription
    // above is not part of it — the user speaking is usually what prompted the
    // interrupt in the first place.
    if (this.turnCondemned) {
      if (content.turnComplete) {
        this.handleTurnComplete();
      }
      return;
    }

    if (content.outputTranscription?.text || content.modelTurn) {
      this.modelTurnInFlight = true;
    }

    if (content.outputTranscription?.text) {
      this.appendAssistantText(content.outputTranscription.text);
    }

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        // Queued, not played: chunks arrive far faster than real time, so
        // `audio.output.started` and the gate anchor wait for the scheduler to
        // actually start sounding.
        this.playbackScheduler?.enqueue(base64ToBytes(part.inlineData.data));
      }
    }

    // Last, and `interrupted` before `turnComplete`: both settle a turn whose
    // audio and text the block above has already handed on.
    if (content.interrupted) {
      this.handleInterrupted();
    }

    if (content.turnComplete) {
      this.handleTurnComplete();
    }
  }

  /**
   * Server VAD cut the turn off. The accumulated text deliberately survives:
   * the turn still reports `assistant.response.completed` at its own
   * `turnComplete` with whatever it managed to say, which is the shape the
   * OpenAI client already has for a VAD-cancelled response reporting its
   * `response.done`.
   */
  private handleInterrupted(): void {
    // The offset from the voice becoming audible is what keeps
    // `CONVERGENCE_GATE_MS` tunable from data rather than from its own comment:
    // every measured Safari interruption landed ~0.5 s after playback began.
    const offset =
      this.hasStartedAudioOutput && this.playbackAudibleSince !== null
        ? `${Math.round(performance.now() - this.playbackAudibleSince)}ms after playback started`
        : "with nothing playing";
    this.log(`Gemini Live turn interrupted ${offset}`);

    this.turnInterrupted = true;
    // The turn is dead, so there is nothing left for a later `interrupt()` to
    // condemn. Left standing, this would survive the turn boundary if
    // `turnComplete` ever failed to follow, and the next `interrupt()` with
    // nothing open would suppress a whole innocent turn in silence.
    this.modelTurnInFlight = false;
    this.playbackScheduler?.flush();
    this.endAudioOutput();
  }

  /**
   * Settle the turn that `turnComplete` just closed.
   *
   * Two callers, two worlds. `applyServerMessage`'s condemned branch brings a
   * turn a local `interrupt()` killed: it reports nothing and its audio ended
   * back at the interrupt. The normal path brings a turn that ran: it reports
   * its completion, and may still owe an ending. Everything between is per-turn
   * state both worlds drop.
   */
  private handleTurnComplete(): void {
    // Read and cleared first, as in `endAudioOutput`: this is the single exit
    // from condemnation, and see `turnCondemned` for why the turn is silent.
    const wasCondemned = this.turnCondemned;
    this.turnCondemned = false;

    // Emitted unconditionally, including with empty text — deliberately unlike
    // `openai/client.ts`, which skips empty completions because its tool-using
    // turns are measured to report twice. Gemini's do not: a live tool-using
    // turn was measured emitting exactly ONE completion for the whole turn
    // (`tests/gemini-live-smoke/README.md`), so an empty-text skip here would
    // swallow the only completion the turn has and strand the manager's send
    // lock for good. Do not port the sibling's skip.
    if (!wasCondemned) {
      this.emitEvent({
        type: "assistant.response.completed",
        text: this.assistantText,
        usage: this.latestUsage,
      });
    }

    this.modelTurnInFlight = false;
    this.assistantText = "";
    this.hasStartedAssistantResponse = false;
    this.latestUsage = undefined;

    // "An ending is still owed", which is why it is set from the active-output
    // flag instead of to a bare `true`. With no output active — a turn that
    // carried no audio, or one whose audio already ended at an interruption
    // flush — nothing would ever clear it, and the *next* turn's opening drain,
    // measured 3 ms in, would read as this turn's ending.
    this.turnCompleteSeen = this.hasStartedAudioOutput;
    if (!this.turnCompleteSeen) {
      return;
    }

    // Idle right now means the final drain has already come and gone, and it
    // will not come again, so the ending belongs here. Asked of the scheduler
    // live rather than remembered: the drain that ends a turn and the spurious
    // one that opens it are the same event, so a sticky has-drained flag would
    // end the turn while the character is still talking.
    if (this.playbackScheduler?.isIdle()) {
      this.endAudioOutput();
    }
  }

  /**
   * Fan a `toolCall` frame out, one `tool.call` per usable entry, recording the
   * id -> name pairing each answer will need.
   *
   * This frame's shape comes from the API reference and has never been seen
   * live — the spike registered no tools (`tests/gemini-live-smoke/README.md`)
   * — so an entry missing either field is *reported* rather than trusted or
   * dropped in silence: without both there is no answer this client can send,
   * and a session that runs on while the model waits forever for a response
   * fails invisibly. It travels as a transport `error`, which `RealtimeManager`
   * handles without ending the session — releasing the send lock, so the user
   * is not stuck. Killing the socket over it would instead livelock: recovery
   * succeeds because the socket was never the problem, the model re-issues the
   * same call on the fresh session, and every lap burns another `uses: 1`
   * token. Strictness belongs on shapes that have been measured.
   *
   * The whole frame is decided before any of it is emitted, so a malformed
   * entry cannot destroy a well-formed sibling whose handler is already
   * running and whose id would be cleared out from under it. The report names
   * the keys that did arrive — enough to read the real shape off one failure —
   * and never quotes argument values.
   *
   * This covers the one absence worth surviving: an entry that arrived and
   * cannot be answered. A payload that is not this shape at all — a null entry,
   * a `functionCalls` that is not an array — still throws into the message
   * pump's fatal catch, and nothing here parses defensively for it.
   */
  private handleToolCall(calls: GeminiFunctionCall[]): void {
    const usable: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    const unusable: string[] = [];

    for (const call of calls) {
      if (call.id && call.name) {
        usable.push({ id: call.id, name: call.name, args: call.args ?? {} });
      } else {
        unusable.push(`{${Object.keys(call).join(", ")}}`);
      }
    }

    for (const call of usable) {
      // Recorded before the event goes out, so a handler that answers on the
      // spot finds its id already there.
      this.pendingToolCalls.set(call.id, call.name);
      this.emitEvent({
        type: "tool.call",
        name: call.name,
        args: call.args,
        callId: call.id,
      });
    }

    if (unusable.length > 0) {
      this.emitEvent({
        type: "error",
        error: new Error(
          `Gemini Live sent tool calls this client cannot answer: an id or name is missing (keys received: ${unusable.join(" ")})`,
        ),
      });
    }
  }

  /**
   * Output transcription is the only assistant text a native-audio session
   * produces, and the server keeps it on, so the response's whole lifecycle
   * hangs off these fragments.
   */
  private appendAssistantText(text: string): void {
    if (!this.hasStartedAssistantResponse) {
      this.hasStartedAssistantResponse = true;
      this.emitEvent({ type: "assistant.response.started" });
    }

    this.assistantText += text;
    this.emitEvent({ type: "assistant.text.delta", text });
  }

  /**
   * The scheduler started sounding.
   *
   * Only the first such transition of a turn opens the turn's audio. This fires
   * again after every mid-turn underrun, and re-anchoring the gate on those
   * would let a stalling connection hold it open for a whole reply — silently,
   * which is the failure class the measured record warns about. Anchoring once
   * per session is equally wrong: the measured Safari run was interrupted 0.5 s
   * into its *second* turn. So the anchor is per turn, and it is left standing
   * when playback stops, because the window has to expire on its own clock
   * rather than on a silence the acoustic path has not caught up with yet.
   *
   * The unconditional first line is the other half of the pairing: it opens the
   * audible span that `bankAudibleExposure` closes, once per sounding stretch
   * rather than once per turn.
   */
  private beginAudiblePlayback(): void {
    const now = performance.now();
    this.audibleSpanStartedAt = now;

    if (this.hasStartedAudioOutput) {
      return;
    }

    this.hasStartedAudioOutput = true;
    this.playbackAudibleSince = now;
    this.lipSyncAnalyzer.resume();
    this.emitEvent({ type: "audio.output.started" });
  }

  /**
   * Close the open audible span into the exposure total.
   *
   * Only these playing → not-playing intervals count towards the gate. A
   * first-audible → `audio.output.ended` span would count silence the canceller
   * never got to adapt to: `turnComplete` is paced to the audio's duration from
   * the *first* chunk, so a burst-delivered turn sits quiet for seconds waiting
   * on it — a measured 12 s span for 10.5 s of audio, and 6.5 s for 5.1 s.
   */
  private bankAudibleExposure(): void {
    if (this.audibleSpanStartedAt === null) {
      return;
    }

    this.audibleExposureMs += performance.now() - this.audibleSpanStartedAt;
    this.audibleSpanStartedAt = null;
  }

  /**
   * The single place `audio.output.ended` is emitted. Callers decide *that* the
   * audio ended — always from the scheduler being idle and `turnComplete` seen,
   * never from a timer or an RMS reading — and this keeps the start/end pair
   * balanced and settles the gate.
   *
   * Both interrupt paths flush the scheduler immediately before calling in.
   * That flush is what closes the open audible span through
   * `onPlayingChange(false)`, so the gate below settles against a total that
   * includes it.
   */
  private endAudioOutput(): void {
    // Read and cleared above the guard, not below it: an `interrupted` that
    // lands before any audio was audible ends nothing, and leaving the flag set
    // would make the *next* turn end as an interrupted one and refuse to disarm
    // the gate. Clearing here also means no caller has to assume `turnComplete`
    // always follows `interrupted`.
    const wasInterrupted = this.turnInterrupted;
    this.turnInterrupted = false;

    if (!this.hasStartedAudioOutput) {
      return;
    }

    this.hasStartedAudioOutput = false;
    this.turnCompleteSeen = false;

    // Paused before the end is reported, as in the OpenAI client: the analyzer
    // smooths its readings and would keep emitting a decaying level, which
    // `RealtimeManager` turns back into an audio start with nothing left to
    // close it.
    this.lipSyncAnalyzer.pause();
    this.emitEvent({ type: "audio.output.ended" });

    // A turn disarms the gate only by running to a clean end, and only once the
    // canceller has had `CONVERGENCE_GATE_MS` of audible speech to adapt to.
    // The total is cumulative across the session and killed turns bank into it
    // as well: the two interrupted Safari turns banked ~1 s between them and
    // the third then ran seven seconds untouched. So a short clean reply leaves
    // the gate armed however cleanly it finished, and an interrupted turn
    // leaves it armed however long it ran.
    if (
      this.gateArmed &&
      !wasInterrupted &&
      this.audibleExposureMs >= CONVERGENCE_GATE_MS
    ) {
      this.gateArmed = false;
      this.log(
        `Convergence gate disarmed after ${Math.round(this.audibleExposureMs)}ms of audible playback`,
      );
    }
  }

  /**
   * The socket a frame can go out on right now, or null. `setupComplete` is
   * part of the answer: until the server acknowledges setup there is no session
   * to receive anything. Callers differ only in what they make of a null.
   */
  private getReadySocket(): WebSocket | null {
    const socket = this.activeSocket?.socket;
    if (
      !socket ||
      !this.isSetupComplete ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return null;
    }

    return socket;
  }

  /**
   * `getReadySocket()` for the caller-driven frames, which refuse rather than
   * drop: `sendText()` and `sendToolResult()` have someone to tell.
   *
   * The recovery guard stays at those call sites instead of folding in here as
   * the OpenAI client's does, so a `sendToolResult()` during a reconnect
   * reports the reconnect rather than the unknown call id it would otherwise
   * hit — the map is already empty by then.
   */
  private requireReadySocket(): WebSocket {
    const socket = this.getReadySocket();
    if (!socket) {
      throw new Error("Gemini Live session is not ready to send");
    }

    return socket;
  }

  /**
   * The only path microphone audio takes to the wire.
   *
   * Frames are dropped rather than queued whenever `getReadySocket()` says they
   * cannot go out now: a frame held across a reconnect is audio the user spoke
   * into a session that has ended.
   */
  private sendCaptureFrame(frame: Uint8Array): void {
    const socket = this.getReadySocket();
    if (!socket) {
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
   * audible.
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
    // Zeroed after the flush above, which banks its final span into the total
    // being discarded here.
    this.audibleExposureMs = 0;
    this.audibleSpanStartedAt = null;

    // Turn state is dropped rather than completed: the turn it describes
    // belonged to the socket just closed. No pairing `audio.output.ended` is
    // emitted for a turn cut off this way — `RealtimeManager` closes its own
    // audio output when it hears `connection.lost`. This is also the roster of
    // what "per-turn" means: everything `handleTurnComplete()` and
    // `endAudioOutput()` own between them.
    this.hasStartedAudioOutput = false;
    this.turnCompleteSeen = false;
    this.turnInterrupted = false;
    this.modelTurnInFlight = false;
    this.turnCondemned = false;
    this.hasStartedAssistantResponse = false;
    this.assistantText = "";
    this.latestUsage = undefined;

    // Session-scoped, per `pendingToolCalls`. The terminal `cleanup()` inherits
    // this, since it runs the reset first.
    this.pendingToolCalls.clear();

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

/**
 * Mirrors `bytesToBase64`, and is called from inside the message pump's error
 * boundary: `atob` throws on a malformed payload, which is protocol-fatal like
 * any other frame this client cannot read.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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
