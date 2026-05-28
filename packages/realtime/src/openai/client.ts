import type {
  RealtimeReconnectCause,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import { acquireMicrophoneStream } from "../internal/microphone";
import {
  bindTransportLifecycle,
  createIceDisconnectDebouncer,
  DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS,
  replaceMicrophoneTrack,
} from "../internal/webrtc-lifecycle";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
  isRecord,
} from "../internal/shared";
import { delay } from "../internal/timing";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import { DEFAULT_OPENAI_REALTIME_VOICE } from "./defaults";

interface ServerError {
  code?: string;
  event_id?: string;
  message?: string;
}

interface ServerEventItem {
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ServerEvent {
  type: string;
  event_id?: string;
  delta?: string;
  text?: string;
  transcript?: string;
  call_id?: string;
  item_id?: string;
  name?: string;
  arguments?: string;
  item?: ServerEventItem;
  error?: ServerError;
  response?: {
    id?: string;
    model?: string;
    usage?: Record<string, unknown>;
  };
}

export interface OpenAIRealtimeClientOptions {
  apiEndpoint?: string;
  debug?: boolean;
  sessionUpdateTimeoutMs?: number;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
}

interface PendingSessionUpdate {
  eventId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const DEBUG_EVENT_ALLOWLIST = new Set<string>([
  "session.created",
  "session.updated",
  "response.created",
  "response.done",
  "response.function_call_arguments.done",
  "conversation.item.input_audio_transcription.completed",
  "error",
]);
const DEFAULT_SESSION_UPDATE_TIMEOUT_MS = 5_000;

/**
 * OpenAI-specific realtime transport client.
 *
 * This package normalizes OpenAI Realtime WebRTC events into the transport
 * event contract defined by `@charivo/realtime`.
 */
export class OpenAIRealtimeClient implements RealtimeTransportClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaStream: MediaStream | null = null;
  private audioSender: RTCRtpSender | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private lipSyncInterval: number | null = null;
  private isResponseInProgress = false;
  private cancelInFlight = false;
  private hasStartedAssistantResponse = false;
  private hasStartedAudioOutput = false;
  private assistantText = "";
  private nextSessionUpdateId = 1;
  private pendingSessionUpdate: PendingSessionUpdate | null = null;
  private currentSessionConfig?: RealtimeSessionConfig;
  private connectionLossNotified = false;
  private isExplicitDisconnect = false;
  private isRecovering = false;
  private isCleaningUp = false;
  private teardownTransportLifecycle?: () => void;
  private readonly iceDisconnectDebouncer = createIceDisconnectDebouncer(() => {
    this.emitConnectionLost("ice-disconnected");
  }, DEFAULT_ICE_DISCONNECTED_DEBOUNCE_MS);
  private eventCallbacks = new Set<(event: RealtimeTransportEvent) => void>();

  constructor(private options: OpenAIRealtimeClientOptions = {}) {}

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    try {
      if (this.isExplicitDisconnect && this.isRecovering) {
        throw new Error("Realtime session disconnect requested");
      }

      this.log("Starting OpenAI Realtime WebRTC connection");

      this.isExplicitDisconnect = false;
      this.isRecovering = false;
      this.connectionLossNotified = false;
      this.currentSessionConfig = config;
      this.pc = new RTCPeerConnection();
      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute("playsinline", "true");
      this.prepareAudioAnalysis();
      this.bindConnectionEvents();
      this.bindTransportLifecycleEvents();

      this.pc.ontrack = (event) => {
        if (this.audioElement) {
          this.audioElement.srcObject = event.streams[0];
        }
        this.setupAudioAnalysis(event.streams[0]);
      };

      try {
        this.mediaStream = await acquireMicrophoneStream();
        const audioTrack = this.mediaStream.getTracks()[0];
        this.audioSender =
          this.pc.addTrack(audioTrack, this.mediaStream) ?? this.audioSender;
      } catch {
        throw new Error("Microphone access required for Realtime API");
      }

      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.onmessage = (event) => {
        const payload = JSON.parse(event.data) as ServerEvent;
        this.handleServerEvent(payload);
      };
      this.dc.onerror = () => {
        this.emitEvent({
          type: "error",
          error: new Error("DataChannel error"),
        });
      };

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const bootstrap = await this.getSessionBootstrap({
        transport: "webrtc",
        session: config ?? {},
        sdpOffer: offer.sdp,
      });

      const answerSdp = this.resolveWebRTCAnswerSdp(bootstrap);

      await this.pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      this.emitEvent({ type: "session.started" });
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting OpenAI Realtime WebRTC");
    this.isExplicitDisconnect = true;
    this.isRecovering = false;
    this.cleanup();
  }

  async updateSession(config?: RealtimeSessionConfig): Promise<void> {
    if (this.isResponseInProgress) {
      throw new Error(
        "Cannot update the realtime session while a response is in progress. Call interrupt() first.",
      );
    }

    const dc = this.requireOpenDataChannel();
    const eventId = `charivo-session-update-${this.nextSessionUpdateId++}`;

    if (this.pendingSessionUpdate) {
      throw new Error("Realtime session update already in progress");
    }

    dc.send(
      JSON.stringify({
        type: "session.update",
        event_id: eventId,
        session: toOpenAIRealtimeSessionUpdate(config),
      }),
    );

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.rejectPendingSessionUpdate(
          new Error(
            `Timed out waiting for session.updated after ${this.getSessionUpdateTimeoutMs()}ms`,
          ),
        );
      }, this.getSessionUpdateTimeoutMs());

      this.pendingSessionUpdate = {
        eventId,
        resolve,
        reject,
        timeoutId,
      };
    });

    this.currentSessionConfig = config;
  }

  async recover(config?: RealtimeSessionConfig): Promise<void> {
    this.isRecovering = true;
    this.connectionLossNotified = true;
    this.currentSessionConfig = config;

    try {
      if (await this.tryIceRestartRecovery(config)) {
        this.connectionLossNotified = false;
        return;
      }

      await this.rebuildConnection(config);
      this.connectionLossNotified = false;
    } finally {
      this.isRecovering = false;
    }
  }

  async sendText(text: string): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel not ready");
    }

    if (this.isResponseInProgress) {
      console.warn("⚠️ Response already in progress, skipping request");
      return;
    }

    this.dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text,
            },
          ],
        },
      }),
    );
    this.dc.send(JSON.stringify({ type: "response.create" }));

    this.beginResponseRequest();
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

    const dc = this.requireOpenDataChannel();

    dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
    dc.send(JSON.stringify({ type: "response.create" }));

    this.beginResponseRequest();
  }

  async interrupt(): Promise<void> {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    const dc = this.requireOpenDataChannel();

    if (!this.isResponseInProgress) {
      return;
    }

    dc.send(JSON.stringify({ type: "response.cancel" }));
    this.isResponseInProgress = false;
    this.cancelInFlight = true;
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
  }

  private handleServerEvent(event: ServerEvent): void {
    if (this.options.debug && this.shouldLogDebugEvent(event.type)) {
      this.log("📡 [OpenAI Realtime Event]", event.type, event);
    }

    switch (event.type) {
      case "session.created":
        return;

      case "session.updated":
        this.resolvePendingSessionUpdate();
        return;

      case "response.audio.delta":
      case "output_audio_buffer.started":
        if (this.cancelInFlight) {
          return;
        }

        if (!this.hasStartedAudioOutput) {
          this.hasStartedAudioOutput = true;
          this.emitEvent({ type: "audio.output.started" });
        }
        return;

      case "response.audio.done":
      case "response.output_audio.done":
      case "output_audio_buffer.stopped":
        if (this.cancelInFlight) {
          this.hasStartedAudioOutput = false;
          return;
        }

        this.emitEvent({ type: "audio.output.ended" });
        this.hasStartedAudioOutput = false;
        return;

      case "response.done":
        this.isResponseInProgress = false;
        if (this.cancelInFlight) {
          this.cancelInFlight = false;
          this.resetResponseTracking();
          return;
        }

        // Tool-using turns fire response.done twice per user message: once
        // after the tool call (no text this cycle) and once after the
        // follow-up reply. Skip the first one so consumers see a single
        // completion per user turn. Keeping tracking live means the
        // follow-up cycle does not re-emit assistant.response.started.
        if (!this.assistantText) {
          return;
        }

        this.emitEvent({
          type: "assistant.response.completed",
          text: this.assistantText,
          usage: event.response?.usage,
          model: event.response?.model,
          responseId: event.response?.id,
        });
        this.resetResponseTracking();
        return;

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        if (this.cancelInFlight || !event.delta) {
          return;
        }

        this.ensureAssistantResponseStarted();

        this.assistantText += event.delta;
        this.emitEvent({
          type: "assistant.text.delta",
          text: event.delta,
        });
        return;

      case "response.output_text.done":
        if (this.cancelInFlight || !event.text) {
          return;
        }
        this.emitFinalAssistantText(event.text);
        return;

      case "response.output_audio_transcript.done":
        if (this.cancelInFlight || !event.transcript) {
          return;
        }
        this.emitFinalAssistantText(event.transcript);
        return;

      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript) {
          this.emitEvent({
            type: "user.transcript",
            text: event.transcript,
          });
        }
        return;

      case "response.function_call_arguments.done":
        this.handleToolCallDone(event);
        return;

      case "error":
        this.isResponseInProgress = false;
        this.cancelInFlight = false;
        {
          const error = new Error(event.error?.message || "Unknown error");
          if (this.isPendingSessionUpdateError(event)) {
            this.rejectPendingSessionUpdate(error);
          }

          this.emitEvent({
            type: "error",
            error,
          });
        }
        return;

      default:
        return;
    }
  }

  private handleToolCallDone(event: ServerEvent): void {
    const callId = event.call_id || event.item?.call_id || event.item_id;
    const name = event.name || event.item?.name;
    const argsJson = event.arguments || event.item?.arguments;

    if (!name || !argsJson) {
      console.warn("⚠️ Tool call done but missing name or arguments");
      return;
    }

    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argsJson) as unknown;
      if (isRecord(parsed)) {
        args = parsed;
      }
    } catch (error) {
      console.error("Failed to parse tool call args", error, argsJson);
      return;
    }

    this.emitEvent({
      type: "tool.call",
      name,
      args,
      callId,
    });
  }

  private async getSessionBootstrap(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    if (this.options.sessionBootstrap) {
      return this.options.sessionBootstrap(request);
    }

    const apiEndpoint = this.options.apiEndpoint;
    if (!apiEndpoint) {
      throw new Error(
        "OpenAI realtime client requires apiEndpoint or sessionBootstrap",
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
      `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Realtime session: ${errorText}`);
    }

    const bootstrap = (await response.json()) as unknown;
    if (!isRealtimeSessionBootstrap(bootstrap)) {
      throw new Error("Invalid realtime session bootstrap response");
    }

    return bootstrap as RealtimeSessionBootstrap;
  }

  private bindConnectionEvents(): void {
    if (!this.pc) {
      return;
    }

    this.pc.addEventListener("iceconnectionstatechange", () => {
      const iceState = this.pc?.iceConnectionState;
      if (iceState === "failed") {
        this.iceDisconnectDebouncer.cancel();
        this.emitConnectionLost("ice-failed");
      } else if (iceState === "disconnected") {
        this.iceDisconnectDebouncer.schedule();
      } else {
        this.iceDisconnectDebouncer.cancel();
      }
    });

    this.pc.addEventListener("connectionstatechange", () => {
      const connectionState = this.pc?.connectionState;
      if (connectionState === "failed" || connectionState === "closed") {
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
    this.pauseAudioAnalysis();
  };

  private readonly handleVisible = (): void => {
    this.resumeAudioAnalysis();
    this.emitConnectionLost("visibility");
  };

  private readonly handlePageHide = (): void => {
    this.pauseAudioAnalysis();
  };

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    this.resumeAudioAnalysis();
    if (event.persisted) {
      this.emitConnectionLost("pageshow");
    }
  };

  private readonly handleDeviceChange = (): void => {
    void this.refreshMicrophoneTrack();
  };

  private async refreshMicrophoneTrack(): Promise<void> {
    if (!this.pc || this.isExplicitDisconnect) {
      return;
    }

    try {
      const { audioSender, mediaStream } = await replaceMicrophoneTrack({
        audioSender: this.audioSender,
        mediaStream: this.mediaStream,
        peerConnection: this.pc,
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

  private emitConnectionLost(
    cause: RealtimeReconnectCause,
    error?: Error,
  ): void {
    if (
      this.connectionLossNotified ||
      this.isExplicitDisconnect ||
      this.isCleaningUp ||
      !this.pc ||
      !this.dc ||
      !this.needsRecovery(cause)
    ) {
      return;
    }

    this.connectionLossNotified = true;
    this.isResponseInProgress = false;
    this.cancelInFlight = false;
    this.resetResponseTracking();
    this.stopLipSyncAnalysis();
    this.emitEvent({
      type: "connection.lost",
      cause,
      error,
    });
  }

  private needsRecovery(cause: RealtimeReconnectCause): boolean {
    if (!this.pc || !this.dc) {
      return false;
    }

    if (
      cause === "visibility" ||
      cause === "pageshow" ||
      cause === "offline" ||
      cause === "online"
    ) {
      return (
        this.dc.readyState !== "open" ||
        this.pc.connectionState === "failed" ||
        this.pc.connectionState === "closed" ||
        this.pc.iceConnectionState === "failed" ||
        this.pc.iceConnectionState === "disconnected"
      );
    }

    return true;
  }

  private prepareAudioAnalysis(): void {
    if (this.audioContext) {
      return;
    }

    const audioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!audioContextConstructor) {
      return;
    }

    this.audioContext = new audioContextConstructor();
  }

  private setupAudioAnalysis(stream: MediaStream): void {
    try {
      this.prepareAudioAnalysis();
      if (!this.audioContext) {
        return;
      }

      this.audioSource?.disconnect();
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.audioSource.connect(this.analyser);

      this.startLipSyncAnalysis();
    } catch (error) {
      console.error("Failed to setup audio analysis:", error);
    }
  }

  private startLipSyncAnalysis(): void {
    if (!this.analyser) {
      return;
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    this.lipSyncInterval = window.setInterval(() => {
      if (!this.analyser) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let index = 0; index < bufferLength; index += 1) {
        const normalized = dataArray[index] / 255;
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / bufferLength);
      this.emitEvent({
        type: "audio.lipsync",
        rms: Math.min(rms * 3, 1),
      });
    }, 1000 / 60);
  }

  private stopLipSyncAnalysis(): void {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }

    this.emitEvent({ type: "audio.lipsync", rms: 0 });
  }

  private pauseAudioAnalysis(): void {
    this.stopLipSyncAnalysis();
  }

  private resumeAudioAnalysis(): void {
    if (!this.analyser || this.lipSyncInterval) {
      return;
    }

    this.startLipSyncAnalysis();
  }

  private cleanup(): void {
    this.isCleaningUp = true;
    this.unbindTransportLifecycleEvents();
    this.iceDisconnectDebouncer.cancel();
    this.stopLipSyncAnalysis();
    this.rejectPendingSessionUpdate(
      new Error("Realtime session ended before session update completed"),
    );

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioElement) {
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioSource = null;
    this.audioSender = null;
    this.analyser = null;
    this.isResponseInProgress = false;
    this.cancelInFlight = false;
    this.connectionLossNotified = false;
    this.isCleaningUp = false;
    this.resetResponseTracking();
  }

  private beginResponseRequest(): void {
    this.resetResponseTracking();
    this.isResponseInProgress = true;
    this.cancelInFlight = false;
  }

  private requireOpenDataChannel(): RTCDataChannel {
    if (this.isRecovering) {
      throw new Error("Realtime transport reconnecting");
    }

    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel not ready");
    }

    return this.dc;
  }

  private async tryIceRestartRecovery(
    config?: RealtimeSessionConfig,
  ): Promise<boolean> {
    const pc = this.pc;
    if (!pc || this.shouldRebuildConnection()) {
      return false;
    }

    if (pc.iceConnectionState === "connected") {
      return true;
    }

    if (pc.iceConnectionState === "disconnected") {
      await delay(1_500);
      if (pc.iceConnectionState !== "disconnected") {
        return true;
      }
    }

    if (
      pc.iceConnectionState === "failed" ||
      pc.connectionState === "failed" ||
      pc.connectionState === "closed"
    ) {
      return false;
    }

    if (typeof pc.restartIce === "function") {
      pc.restartIce();
    }

    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);

    const bootstrap = await this.getSessionBootstrap({
      transport: "webrtc",
      session: config ?? this.currentSessionConfig ?? {},
      sdpOffer: offer.sdp,
    });

    const answerSdp = this.resolveWebRTCAnswerSdp(bootstrap);

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
    return true;
  }

  private shouldRebuildConnection(): boolean {
    return (
      !this.pc ||
      !this.dc ||
      this.dc.readyState === "closed" ||
      this.pc.connectionState === "failed" ||
      this.pc.connectionState === "closed" ||
      this.pc.iceConnectionState === "failed"
    );
  }

  private async rebuildConnection(
    config?: RealtimeSessionConfig,
  ): Promise<void> {
    this.connectionLossNotified = true;
    this.cleanup();
    await this.connect(config ?? this.currentSessionConfig);
  }

  private resolvePendingSessionUpdate(): void {
    if (!this.pendingSessionUpdate) {
      return;
    }

    clearTimeout(this.pendingSessionUpdate.timeoutId);
    this.pendingSessionUpdate.resolve();
    this.pendingSessionUpdate = null;
  }

  private rejectPendingSessionUpdate(error: Error): void {
    if (!this.pendingSessionUpdate) {
      return;
    }

    clearTimeout(this.pendingSessionUpdate.timeoutId);
    this.pendingSessionUpdate.reject(error);
    this.pendingSessionUpdate = null;
  }

  private isPendingSessionUpdateError(event: ServerEvent): boolean {
    const pendingUpdate = this.pendingSessionUpdate;
    if (!pendingUpdate) {
      return false;
    }

    return event.error?.event_id === pendingUpdate.eventId;
  }

  private getSessionUpdateTimeoutMs(): number {
    return (
      this.options.sessionUpdateTimeoutMs ?? DEFAULT_SESSION_UPDATE_TIMEOUT_MS
    );
  }

  private resolveWebRTCAnswerSdp(bootstrap: RealtimeSessionBootstrap): string {
    if (
      bootstrap.adapter !== OPENAI_REALTIME_ADAPTER ||
      bootstrap.transport !== "webrtc" ||
      !("answerSdp" in bootstrap)
    ) {
      throw new Error(
        `OpenAI realtime client only supports ${OPENAI_REALTIME_ADAPTER} bootstrap, received ${bootstrap.adapter}/${bootstrap.transport}`,
      );
    }
    return bootstrap.answerSdp;
  }

  private resetResponseTracking(): void {
    this.assistantText = "";
    this.hasStartedAssistantResponse = false;
    this.hasStartedAudioOutput = false;
  }

  private ensureAssistantResponseStarted(): void {
    if (!this.hasStartedAssistantResponse) {
      this.hasStartedAssistantResponse = true;
      this.emitEvent({ type: "assistant.response.started" });
    }
  }

  private emitFinalAssistantText(full: string): void {
    this.ensureAssistantResponseStarted();

    if (full !== this.assistantText) {
      const delta = full.startsWith(this.assistantText)
        ? full.slice(this.assistantText.length)
        : full;

      this.assistantText = full;
      if (delta) {
        this.emitEvent({
          type: "assistant.text.delta",
          text: delta,
        });
      }
    }
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

  private shouldLogDebugEvent(eventType: string): boolean {
    if (DEBUG_EVENT_ALLOWLIST.has(eventType)) {
      return true;
    }

    return eventType.startsWith("response.output_text.");
  }
}

export function createOpenAIRealtimeClient(
  options?: OpenAIRealtimeClientOptions,
): RealtimeTransportClient {
  return new OpenAIRealtimeClient(options);
}

function toOpenAIRealtimeSessionUpdate(
  config?: RealtimeSessionConfig,
): Record<string, unknown> {
  const audio: Record<string, unknown> = {
    output: {
      voice: config?.voice ?? DEFAULT_OPENAI_REALTIME_VOICE,
    },
  };

  const transcription = config?.inputAudioTranscription;
  if (transcription !== undefined) {
    if (transcription.enabled === false) {
      audio.input = { transcription: null };
    } else if (transcription.model !== undefined) {
      audio.input = { transcription: { model: transcription.model } };
    }
  }

  const session: Record<string, unknown> = {
    audio,
    tool_choice: config?.toolChoice ?? "auto",
  };

  if (config?.instructions) {
    session.instructions = config.instructions;
  }

  if (config?.temperature !== undefined) {
    session.temperature = config.temperature;
  }

  if (config?.maxTokens !== undefined) {
    session.max_response_output_tokens = config.maxTokens;
  }

  if (config && "tools" in config) {
    session.tools = config.tools ?? [];
  }

  return session;
}
