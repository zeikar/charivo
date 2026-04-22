import type {
  RealtimeReconnectCause,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  OPENAI_REALTIME_AGENTS_ADAPTER,
  subscribeBrowserLifecycle,
} from "@charivo/core";
import { acquireMicrophoneStream } from "../internal/microphone";
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
import { LipSyncAnalyzer } from "./lip-sync-analyzer";
import {
  resolveInstructions,
  resolveVoice,
  toOpenAIRealtimeAgentsSessionConfig,
} from "./session-config";
import { createToolSchemaOptions } from "./tool-schema";

interface PendingToolCall {
  resolve: (output: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface AssistantState {
  text: string;
  started: boolean;
}

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
const ICE_DISCONNECTED_DEBOUNCE_MS = 1_000;

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
  private latestHistory: RealtimeItem[] = [];
  private currentSessionConfig?: RealtimeSessionConfig;
  private teardownBrowserLifecycle?: () => void;
  private pendingIceDisconnect: ReturnType<typeof setTimeout> | null = null;
  private readonly eventCallbacks = new Set<
    (event: RealtimeTransportEvent) => void
  >();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly lipSyncAnalyzer = new LipSyncAnalyzer({
    onRms: (rms) => {
      this.emitEvent({ type: "audio.lipsync", rms });
    },
    onError: (error) => {
      console.error("Failed to setup audio analysis:", error);
    },
  });

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
      this.bindBrowserLifecycleEvents();
      this.bindDeviceChangeListener();
      await this.lipSyncAnalyzer.prepareAudioContext();

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
      this.lipSyncAnalyzer.observeAudioElement(this.audioElement);

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
        model: config?.model,
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
      this.emitEvent({ type: "audio.output.started" });
    });

    session.on("audio_stopped", () => {
      this.emitEvent({ type: "audio.output.ended" });
    });

    session.on("history_updated", (history) => {
      this.latestHistory = history;
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
    });
  }

  private bindTransportEvents(transport: OpenAIRealtimeWebRTC): void {
    transport.on("audio_transcript_delta", (event) => {
      this.handleAssistantTranscriptDelta(event);
    });

    transport.on("audio_interrupted", () => {
      this.emitEvent({ type: "audio.output.ended" });
      this.lipSyncAnalyzer.stopOutput();
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
    // would fall back to getLatestAssistantText(), which can return the
    // previous turn's message.
    if (!this.assistant.text && !output.trim()) {
      return;
    }

    const finalText =
      this.getLatestAssistantText() || output || this.assistant.text;

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
    });
    this.resetAssistantTracking();
  }

  private getLatestAssistantText(): string {
    for (let index = this.latestHistory.length - 1; index >= 0; index -= 1) {
      const item = this.latestHistory[index];
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
            this.lipSyncAnalyzer.attachStream(stream);
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
        this.clearPendingIceDisconnect();
        this.emitConnectionLost("ice-failed");
      } else if (iceState === "disconnected") {
        this.scheduleIceDisconnectRecovery();
      } else {
        this.clearPendingIceDisconnect();
      }
    });

    peerConnection.addEventListener("connectionstatechange", () => {
      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        this.clearPendingIceDisconnect();
        this.emitConnectionLost("connection-failed");
      }
    });
  }

  private bindBrowserLifecycleEvents(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: this.handleHidden,
      onOnline: this.handleOnline,
      onPageHide: this.handlePageHide,
      onPageShow: this.handlePageShow,
      onVisible: this.handleVisible,
    });
  }

  private bindDeviceChangeListener(): void {
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      this.handleDeviceChange,
    );
  }

  private unbindBrowserLifecycleEvents(): void {
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.handleDeviceChange,
    );
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
      const nextStream = await acquireMicrophoneStream();
      const nextTrack = nextStream.getAudioTracks()[0];
      if (!nextTrack) {
        throw new Error("Microphone access required for Realtime API");
      }

      const sender =
        this.audioSender ??
        (typeof this.peerConnection.getSenders === "function"
          ? this.peerConnection
              .getSenders()
              .find((candidate) => candidate.track?.kind === "audio")
          : null) ??
        null;
      if (!sender) {
        throw new Error("No outbound audio sender available");
      }

      await sender.replaceTrack(nextTrack);
      this.audioSender = sender;
      this.mediaStream?.getTracks().forEach((track) => track.stop());
      this.mediaStream = nextStream;
    } catch (error) {
      this.emitEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
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
    this.lipSyncAnalyzer.stopOutput();
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

  private cleanup(error?: unknown): void {
    this.connectionWasActive = false;
    this.isCleaningUp = true;
    this.clearPendingIceDisconnect();
    this.unbindBrowserLifecycleEvents();
    this.cleanupPendingToolCalls(error);
    this.lipSyncAnalyzer.cleanup();

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
    this.latestHistory = [];
    this.connectionLossNotified = false;
    this.isCleaningUp = false;
    this.resetAssistantTracking();
  }

  private scheduleIceDisconnectRecovery(): void {
    if (this.pendingIceDisconnect) {
      return;
    }

    this.pendingIceDisconnect = setTimeout(() => {
      this.pendingIceDisconnect = null;
      this.emitConnectionLost("ice-disconnected");
    }, ICE_DISCONNECTED_DEBOUNCE_MS);
  }

  private clearPendingIceDisconnect(): void {
    if (!this.pendingIceDisconnect) {
      return;
    }

    clearTimeout(this.pendingIceDisconnect);
    this.pendingIceDisconnect = null;
  }

  private resetAssistantTracking(): void {
    this.assistant = {
      text: "",
      started: false,
    };
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
