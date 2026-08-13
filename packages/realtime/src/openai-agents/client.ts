import type {
  RealtimeReconnectCause,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  createLipSyncAnalyzer,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";
import { acquireMicrophoneStream } from "../internal/microphone";
import {
  bindTransportLifecycle,
  createIceDisconnectDebouncer,
  DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS,
  replaceMicrophoneTrack,
} from "../internal/webrtc-lifecycle";
import { isRecord } from "../internal/shared";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type OpenAIRealtimeWebRTCOptions,
  type RealtimeItem,
  type TransportLayerTranscriptDelta,
} from "@openai/agents-realtime";
import {
  getOpenAIRealtimeAgentsBootstrap,
  type RealtimeBootstrapLoaderOptions,
} from "./bootstrap";
import {
  resolveInstructions,
  resolveVoice,
  toOpenAIRealtimeAgentsSessionConfig,
} from "./session-config";
import { DEFAULT_OPENAI_REALTIME_MODEL } from "../openai/defaults";
import { createToolSchemaOptions } from "./tool-schema";

interface PendingToolCall {
  resolve: (output: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface AssistantState {
  text: string;
  started: boolean;
}

interface AssistantCompletionMetadata {
  usage?: Record<string, unknown>;
  model?: string;
  responseId?: string;
}

/**
 * @remarks
 * `apiKey` is a dev/testing-only escape hatch. The key is exposed in the
 * browser. For production, use `sessionBootstrap` or `apiEndpoint` instead.
 * Intentional dev/test escape hatch: this direct browser client exposes
 * credentials. For production, see docs/guide/choosing-packages.md#remote.
 */
export interface OpenAIRealtimeAgentsClientOptions
  extends RealtimeBootstrapLoaderOptions {
  debug?: boolean;
}

const DEBUG_EVENT_ALLOWLIST = new Set([
  "conversation.item.input_audio_transcription.completed",
  "error",
]);

const TOOL_RESULT_TIMEOUT_MESSAGE =
  "Realtime session ended before tool result was returned";

// The SDK's `audio_stopped` fires on the server's `response.output_audio.done`,
// which means the server finished SENDING audio — not that the browser finished
// PLAYING it. Over WebRTC there is still buffered audio, so reporting the end
// there cuts consumers off mid-sentence (`RenderManager` drops a held
// expression on `tts:audio:end`, and lip-sync stops with it). The SDK exposes
// no playback-drained signal, so we derive one from the lip-sync analyzer,
// which measures the audio actually coming out: once its RMS has stayed silent
// for a beat, playback really is over.
const AUDIO_DRAIN_RMS_THRESHOLD = 0.02;
// Terminal silence has to outlast the pauses inside natural speech — between
// sentences, or around a breath — otherwise the drain resolves in a gap and the
// rest of the buffered reply plays with the expression already dropped.
const AUDIO_DRAIN_SILENCE_MS = 800;
// The drain is decided on a timer that samples the latest RMS, NOT on the
// analyzer's own callback cadence: that runs on requestAnimationFrame, which a
// backgrounded tab throttles or halts outright.
const AUDIO_DRAIN_POLL_MS = 50;
// A sample older than this means the feed is not reporting — a halted frame
// loop, a suspended AudioContext, or a stream that never attached.
const AUDIO_DRAIN_STALE_RMS_MS = 200;
// Bounds ONLY the no-usable-feed case. While samples keep arriving the drain
// waits them out however long playback runs; ending on a clock while the meter
// still reads audible is the very bug this code exists to fix.
const AUDIO_DRAIN_BLIND_MAX_WAIT_MS = 5_000;

export class OpenAIRealtimeAgentsClient implements RealtimeTransportClient {
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebRTC | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaStream: MediaStream | null = null;
  private peerConnection: RTCPeerConnection | null = null;
  private audioSender: RTCRtpSender | null = null;
  private connectionWasActive = false;
  private connectionLossNotified = false;
  private isExplicitDisconnect = false;
  private isRecovering = false;
  private isCleaningUp = false;
  private assistant: AssistantState = { text: "", started: false };
  private assistantCompletionMetadata: AssistantCompletionMetadata = {};
  private latestAssistantText = "";
  private currentSessionConfig?: RealtimeSessionConfig;
  private teardownTransportLifecycle?: () => void;
  private readonly iceDisconnectDebouncer = createIceDisconnectDebouncer(() => {
    this.emitConnectionLost("ice-disconnected");
  }, DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS);
  private readonly eventCallbacks = new Set<
    (event: RealtimeTransportEvent) => void
  >();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private lastAudioRms = 0;
  /** When the last RMS sample arrived; `null` means the feed never reported. */
  private lastAudioRmsAt: number | null = null;
  private audioDrainStartedAt: number | null = null;
  private audioDrainSilentSince: number | null = null;
  private audioDrainPoll: ReturnType<typeof setInterval> | null = null;
  private readonly lipSyncAnalyzer = createLipSyncAnalyzer({
    onRms: (rms) => {
      this.lastAudioRms = rms;
      this.lastAudioRmsAt = Date.now();
      this.emitEvent({ type: "audio.lipsync", rms });
    },
    onError: (error) => {
      console.error("Failed to setup audio analysis:", error);
    },
  });
  private observedAudioElement: HTMLAudioElement | null = null;
  private observedAudioElementListener: (() => void) | null = null;
  private pendingAudioElementPoll: number | null = null;

  constructor(private options: OpenAIRealtimeAgentsClientOptions = {}) {}

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    try {
      if (this.isExplicitDisconnect && this.isRecovering) {
        throw new Error("Realtime session disconnect requested");
      }

      this.log("Starting OpenAI Agents Realtime WebRTC connection");

      this.isExplicitDisconnect = false;
      this.isRecovering = false;
      this.connectionLossNotified = false;
      this.currentSessionConfig = config;
      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute("playsinline", "true");
      this.mediaStream = await acquireMicrophoneStream();
      this.bindTransportLifecycleEvents();
      await this.lipSyncAnalyzer.prepare();

      const agent = this.createAgent(config);

      this.transport = new OpenAIRealtimeWebRTC(
        this.createTransportOptions(this.audioElement, this.mediaStream),
      );

      this.session = new RealtimeSession(agent, {
        transport: this.transport,
        config: toOpenAIRealtimeAgentsSessionConfig(config),
      });

      this.bindSessionEvents(this.session);
      this.bindTransportEvents(this.transport);
      this.observeAudioElement(this.audioElement);

      const bootstrap = await this.getSessionBootstrap({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        session: config ?? {},
      });

      if (
        bootstrap.adapter !== OPENAI_REALTIME_AGENTS_ADAPTER ||
        bootstrap.transport !== "webrtc" ||
        !("clientSecret" in bootstrap) ||
        typeof bootstrap.clientSecret !== "string"
      ) {
        throw new Error(
          `OpenAI agents realtime client only supports ${OPENAI_REALTIME_AGENTS_ADAPTER} bootstrap, received ${bootstrap.adapter}/${bootstrap.transport}`,
        );
      }

      await this.session.connect({
        apiKey: bootstrap.clientSecret,
        model: config?.model ?? DEFAULT_OPENAI_REALTIME_MODEL,
      });

      this.connectionWasActive = true;
      this.emitEvent({ type: "session.started" });
    } catch (error) {
      this.cleanup(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting OpenAI Agents Realtime WebRTC");
    this.isExplicitDisconnect = true;
    this.isRecovering = false;
    this.cleanup();
  }

  async updateSession(config?: RealtimeSessionConfig): Promise<void> {
    if (!this.session) {
      throw new Error("Realtime session not active");
    }

    // `RealtimeSession.updateAgent(...)` is the only public session-level API
    // that recomputes instructions / tools / voice and applies them without a
    // reconnect. The SDK currently derives that patch from `options.config`
    // plus agent fields, so keep `options.config` aligned here until it
    // exposes a dedicated public config update path on `RealtimeSession`.
    this.session.options.config = toOpenAIRealtimeAgentsSessionConfig(config);
    await this.session.updateAgent(this.createAgent(config));
    this.currentSessionConfig = config;
  }

  async recover(config?: RealtimeSessionConfig): Promise<void> {
    this.isRecovering = true;
    this.connectionLossNotified = true;
    this.currentSessionConfig = config;

    try {
      this.cleanupPendingToolCalls(
        new Error("Realtime session interrupted during reconnect"),
      );
      this.cleanup();
      await this.connect(config ?? this.currentSessionConfig);
      this.connectionLossNotified = false;
    } finally {
      this.isRecovering = false;
    }
  }

  async sendText(text: string): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    if (!this.session) {
      throw new Error("Realtime session not active");
    }

    this.resetAssistantTracking();
    this.session.sendMessage(text);
  }

  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    console.warn(
      "sendAudio is not needed with WebRTC - audio is automatically transmitted",
    );
  }

  async sendToolResult(
    callId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    const pendingCall = this.pendingToolCalls.get(callId);

    if (!pendingCall) {
      throw new Error(`No pending realtime tool call for "${callId}"`);
    }

    this.pendingToolCalls.delete(callId);
    pendingCall.resolve(output);
  }

  async interrupt(): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    if (!this.session) {
      throw new Error("Realtime session not active");
    }

    this.session.interrupt();
    this.assistant.started = false;
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
  }

  async prepareAudio(): Promise<void> {
    await this.lipSyncAnalyzer.prepare();
  }

  private createAgent(config?: RealtimeSessionConfig): RealtimeAgent {
    return new RealtimeAgent({
      name: "charivo-realtime-agent",
      instructions: resolveInstructions(config),
      tools: this.createProxyTools(config?.tools),
      voice: resolveVoice(config),
    });
  }

  private bindSessionEvents(session: RealtimeSession): void {
    session.on("agent_start", () => {
      this.ensureAssistantStarted();
    });

    session.on("agent_end", (_context, _agent, output) => {
      this.finalizeAssistantResponse(output);
    });

    session.on("audio_start", () => {
      // A new segment began before the previous one drained — the character is
      // still speaking, so the pending end is void.
      this.cancelAudioDrain();
      this.lipSyncAnalyzer.resume();
      this.emitEvent({ type: "audio.output.started" });
    });

    session.on("audio_stopped", () => {
      this.beginAudioDrain();
    });

    session.on("history_updated", (history) => {
      this.latestAssistantText = this.extractLatestAssistantText(history);
    });

    session.on("error", ({ error }) => {
      this.emitEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });

    session.on("transport_event", (event) => {
      if (this.options.debug && DEBUG_EVENT_ALLOWLIST.has(event.type)) {
        this.log("📡 [OpenAI Agents Transport Event]", event.type, event);
      }

      if (
        event.type ===
          "conversation.item.input_audio_transcription.completed" &&
        typeof event.transcript === "string"
      ) {
        this.emitEvent({
          type: "user.transcript",
          text: event.transcript,
        });
      }

      if (event.type === "response.done" && isRecord(event.response)) {
        this.assistantCompletionMetadata = {
          usage: isRecord(event.response.usage)
            ? event.response.usage
            : undefined,
          model:
            typeof event.response.model === "string"
              ? event.response.model
              : undefined,
          responseId:
            typeof event.response.id === "string"
              ? event.response.id
              : undefined,
        };
      }
    });
  }

  private bindTransportEvents(transport: OpenAIRealtimeWebRTC): void {
    transport.on("audio_transcript_delta", (event) => {
      this.handleAssistantTranscriptDelta(event);
    });

    transport.on("audio_interrupted", () => {
      // Barge-in cuts playback outright — nothing left to drain.
      this.endAudioOutputNow();
      this.lipSyncAnalyzer.pause();
    });

    transport.on("connection_change", (status) => {
      if (status === "disconnected" && this.connectionWasActive) {
        this.cleanupPendingToolCalls();
        this.connectionWasActive = false;
        this.emitConnectionLost("connection-failed");
      }
    });
  }

  private handleAssistantTranscriptDelta(
    event: TransportLayerTranscriptDelta,
  ): void {
    if (!event.delta) {
      return;
    }

    this.ensureAssistantStarted();
    this.assistant.text += event.delta;
    this.emitEvent({
      type: "assistant.text.delta",
      text: event.delta,
    });
  }

  private ensureAssistantStarted(): void {
    if (this.assistant.started) {
      return;
    }

    this.assistant.started = true;
    this.emitEvent({ type: "assistant.response.started" });
  }

  private finalizeAssistantResponse(output: string): void {
    // Tool-using user turns arrive as two agent_end events: the first after
    // the tool call (no new text this sub-cycle) and the second after the
    // post-tool reply (the real content). Skip the first one so consumers
    // see one completion per user turn instead of two, and keep tracking
    // live so the follow-up sub-cycle does not re-emit
    // assistant.response.started. Without this guard the first agent_end
    // would fall back to latestAssistantText, which can return the
    // previous turn's message.
    if (!this.assistant.text && !output.trim()) {
      return;
    }

    const finalText = this.latestAssistantText || output || this.assistant.text;

    this.ensureAssistantStarted();

    // Prefer streaming deltas, then patch any trailing drift from final history.
    if (
      finalText &&
      finalText.startsWith(this.assistant.text) &&
      finalText !== this.assistant.text
    ) {
      const delta = finalText.slice(this.assistant.text.length);
      if (delta) {
        this.emitEvent({
          type: "assistant.text.delta",
          text: delta,
        });
      }
    }

    this.emitEvent({
      type: "assistant.response.completed",
      text: finalText,
      ...this.assistantCompletionMetadata,
    });
    this.resetAssistantTracking();
  }

  private extractLatestAssistantText(history: RealtimeItem[]): string {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      if (
        item.type === "message" &&
        item.role === "assistant" &&
        Array.isArray(item.content)
      ) {
        const text = item.content
          .map((content) => {
            if (content.type === "output_audio") {
              return content.transcript ?? "";
            }
            if (content.type === "output_text") {
              return content.text;
            }
            return "";
          })
          .join("")
          .trim();

        if (text) {
          return text;
        }
      }
    }

    return "";
  }

  private createProxyTools(
    tools: RealtimeSessionConfig["tools"],
  ): Array<ReturnType<typeof tool>> {
    return (tools ?? []).map((definition) => {
      const execute = async (
        input: unknown,
        _context?: unknown,
        details?: { toolCall?: { callId?: string } },
      ): Promise<Record<string, unknown>> => {
        const toolCallItem = details?.toolCall;
        const callId =
          toolCallItem?.callId ?? this.createToolCallId(definition.name);

        return await new Promise<Record<string, unknown>>((resolve, reject) => {
          this.pendingToolCalls.set(callId, {
            resolve,
            reject,
          });

          this.emitEvent({
            type: "tool.call",
            name: definition.name,
            args: isRecord(input) ? input : {},
            callId,
          });
        });
      };

      const schemaOptions = createToolSchemaOptions(definition.parameters);
      if (schemaOptions.strict) {
        return tool({
          name: definition.name,
          description: definition.description,
          parameters: schemaOptions.parameters,
          strict: true,
          needsApproval: false,
          execute,
        });
      }

      return tool({
        name: definition.name,
        description: definition.description,
        parameters: schemaOptions.parameters,
        strict: false,
        needsApproval: false,
        execute,
      });
    });
  }

  private createTransportOptions(
    audioElement: HTMLAudioElement,
    mediaStream: MediaStream,
  ): OpenAIRealtimeWebRTCOptions {
    return {
      audioElement,
      mediaStream,
      changePeerConnection: async (peerConnection) => {
        this.peerConnection = peerConnection;
        this.audioSender =
          typeof peerConnection.getSenders === "function"
            ? (peerConnection
                .getSenders()
                .find((candidate) => candidate.track?.kind === "audio") ?? null)
            : null;
        this.bindPeerConnectionEvents(peerConnection);
        peerConnection.addEventListener("track", (event) => {
          const stream = event.streams[0];
          if (stream) {
            this.lipSyncAnalyzer.attachMediaStream(stream);
          }
        });
        return peerConnection;
      },
    };
  }

  private bindPeerConnectionEvents(peerConnection: RTCPeerConnection): void {
    peerConnection.addEventListener("iceconnectionstatechange", () => {
      const iceState = peerConnection.iceConnectionState;
      if (iceState === "failed") {
        this.iceDisconnectDebouncer.cancel();
        this.emitConnectionLost("ice-failed");
      } else if (iceState === "disconnected") {
        this.iceDisconnectDebouncer.schedule();
      } else {
        this.iceDisconnectDebouncer.cancel();
      }
    });

    peerConnection.addEventListener("connectionstatechange", () => {
      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        this.iceDisconnectDebouncer.cancel();
        this.emitConnectionLost("connection-failed");
      }
    });
  }

  private bindTransportLifecycleEvents(): void {
    if (this.teardownTransportLifecycle) {
      return;
    }

    this.teardownTransportLifecycle = bindTransportLifecycle({
      onHidden: this.handleHidden,
      onOnline: this.handleOnline,
      onPageHide: this.handlePageHide,
      onPageShow: this.handlePageShow,
      onVisible: this.handleVisible,
      onDeviceChange: this.handleDeviceChange,
    });
  }

  private unbindTransportLifecycleEvents(): void {
    this.teardownTransportLifecycle?.();
    this.teardownTransportLifecycle = undefined;
  }

  private readonly handleOnline = (): void => {
    this.emitConnectionLost("online");
  };

  private readonly handleHidden = (): void => {
    this.lipSyncAnalyzer.pause();
  };

  private readonly handleVisible = (): void => {
    this.lipSyncAnalyzer.resume();
    this.emitConnectionLost("visibility");
  };

  private readonly handlePageHide = (): void => {
    this.lipSyncAnalyzer.pause();
  };

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    this.lipSyncAnalyzer.resume();
    if (event.persisted) {
      this.emitConnectionLost("pageshow");
    }
  };

  private readonly handleDeviceChange = (): void => {
    void this.refreshMicrophoneTrack();
  };

  private async refreshMicrophoneTrack(): Promise<void> {
    if (!this.peerConnection || this.isExplicitDisconnect) {
      return;
    }

    try {
      const { audioSender, mediaStream } = await replaceMicrophoneTrack({
        audioSender: this.audioSender,
        mediaStream: this.mediaStream,
        peerConnection: this.peerConnection,
      });
      this.audioSender = audioSender;
      this.mediaStream = mediaStream;
    } catch (error) {
      this.emitEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private observeAudioElement(audioElement: HTMLAudioElement): void {
    this.stopObservingAudioElement();

    const tryAttachStream = () => {
      const stream = audioElement.srcObject;
      if (stream instanceof MediaStream) {
        this.lipSyncAnalyzer.attachMediaStream(stream);
        this.stopObservingAudioElement();
      }
    };

    this.observedAudioElement = audioElement;
    this.observedAudioElementListener = tryAttachStream;
    audioElement.addEventListener("loadedmetadata", tryAttachStream);
    this.pendingAudioElementPoll = window.setInterval(tryAttachStream, 50);
  }

  private stopObservingAudioElement(): void {
    if (this.pendingAudioElementPoll !== null) {
      clearInterval(this.pendingAudioElementPoll);
      this.pendingAudioElementPoll = null;
    }

    if (this.observedAudioElement && this.observedAudioElementListener) {
      this.observedAudioElement.removeEventListener(
        "loadedmetadata",
        this.observedAudioElementListener,
      );
    }

    this.observedAudioElement = null;
    this.observedAudioElementListener = null;
  }

  private emitConnectionLost(
    cause: RealtimeReconnectCause,
    error?: Error,
  ): void {
    if (
      this.connectionLossNotified ||
      this.isExplicitDisconnect ||
      this.isCleaningUp ||
      !this.shouldRecover(cause)
    ) {
      return;
    }

    this.connectionLossNotified = true;
    this.cleanupPendingToolCalls(
      new Error("Realtime session interrupted during reconnect"),
    );
    this.resetAssistantTracking();
    // The stream is gone, so no further RMS will arrive to resolve a drain.
    this.cancelAudioDrain();
    this.lipSyncAnalyzer.stop();
    this.emitEvent({
      type: "connection.lost",
      cause,
      error,
    });
  }

  private shouldRecover(cause: RealtimeReconnectCause): boolean {
    if (!this.peerConnection) {
      return false;
    }

    if (
      cause === "visibility" ||
      cause === "pageshow" ||
      cause === "offline" ||
      cause === "online"
    ) {
      return (
        this.peerConnection.connectionState === "failed" ||
        this.peerConnection.connectionState === "closed" ||
        this.peerConnection.iceConnectionState === "failed" ||
        this.peerConnection.iceConnectionState === "disconnected"
      );
    }

    return true;
  }

  /**
   * The server finished sending audio. Playback is still draining, so hold the
   * end back until the analyzer reports silence (or the ceiling trips).
   */
  private beginAudioDrain(): void {
    if (this.audioDrainPoll !== null) {
      return;
    }

    this.audioDrainStartedAt = Date.now();
    this.audioDrainSilentSince = null;
    this.audioDrainPoll = setInterval(() => {
      this.sampleAudioDrain();
    }, AUDIO_DRAIN_POLL_MS);
  }

  private sampleAudioDrain(): void {
    const now = Date.now();
    const measuring =
      this.lastAudioRmsAt !== null &&
      now - this.lastAudioRmsAt <= AUDIO_DRAIN_STALE_RMS_MS;

    if (!measuring) {
      // No usable meter: the frame loop is halted, the context is suspended, or
      // no stream ever attached. We cannot see playback, so a zero here is
      // absence of data rather than observed silence — fall back to the blind
      // ceiling instead of treating it as the end.
      this.audioDrainSilentSince = null;
      if (
        this.audioDrainStartedAt !== null &&
        now - this.audioDrainStartedAt >= AUDIO_DRAIN_BLIND_MAX_WAIT_MS
      ) {
        this.endAudioOutputNow();
      }
      return;
    }

    if (this.lastAudioRms > AUDIO_DRAIN_RMS_THRESHOLD) {
      // Still audible. Keep waiting for as long as that holds — there is no
      // deadline here on purpose.
      this.audioDrainSilentSince = null;
      return;
    }

    if (this.audioDrainSilentSince === null) {
      this.audioDrainSilentSince = now;
      return;
    }

    if (now - this.audioDrainSilentSince >= AUDIO_DRAIN_SILENCE_MS) {
      this.endAudioOutputNow();
    }
  }

  /** Drop a pending drain WITHOUT reporting an end — audio resumed. */
  private cancelAudioDrain(): void {
    this.audioDrainStartedAt = null;
    this.audioDrainSilentSince = null;
    if (this.audioDrainPoll !== null) {
      clearInterval(this.audioDrainPoll);
      this.audioDrainPoll = null;
    }
  }

  /**
   * Report the end now, cancelling any pending drain. Used for the paths where
   * audio genuinely stops rather than drains: barge-in, teardown, errors.
   */
  private endAudioOutputNow(): void {
    this.cancelAudioDrain();
    this.emitEvent({ type: "audio.output.ended" });
  }

  private cleanup(error?: unknown): void {
    this.connectionWasActive = false;
    this.isCleaningUp = true;
    this.cancelAudioDrain();
    this.iceDisconnectDebouncer.cancel();
    this.unbindTransportLifecycleEvents();
    this.cleanupPendingToolCalls(error);
    this.stopObservingAudioElement();
    this.lipSyncAnalyzer
      .cleanup()
      .catch((cleanupError) =>
        console.error("Failed to clean up lip-sync analyzer:", cleanupError),
      );

    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }

    if (this.audioElement) {
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks?.().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.peerConnection = null;
    this.audioSender = null;
    this.latestAssistantText = "";
    this.connectionLossNotified = false;
    this.isCleaningUp = false;
    this.resetAssistantTracking();
  }

  private resetAssistantTracking(): void {
    this.assistant = {
      text: "",
      started: false,
    };
    this.assistantCompletionMetadata = {};
  }

  private cleanupPendingToolCalls(error?: unknown): void {
    const toolError =
      error instanceof Error ? error : new Error(TOOL_RESULT_TIMEOUT_MESSAGE);

    for (const pendingCall of this.pendingToolCalls.values()) {
      pendingCall.reject(toolError);
    }

    this.pendingToolCalls.clear();
  }

  private createToolCallId(toolName: string): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${toolName}-${Date.now()}`;
  }

  private async getSessionBootstrap(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    return getOpenAIRealtimeAgentsBootstrap(this.options, request);
  }

  private emitEvent(event: RealtimeTransportEvent): void {
    for (const callback of this.eventCallbacks) {
      callback(event);
    }
  }

  private log(...args: unknown[]): void {
    if (!this.options.debug) {
      return;
    }

    console.debug("[charivo/realtime/openai-agents]", ...args);
  }
}

export function createOpenAIRealtimeAgentsClient(
  options?: OpenAIRealtimeAgentsClientOptions,
): RealtimeTransportClient {
  return new OpenAIRealtimeAgentsClient(options);
}
