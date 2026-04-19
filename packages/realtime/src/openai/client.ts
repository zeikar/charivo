import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
  isRecord,
} from "../internal/shared";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";

interface ServerError {
  message?: string;
}

interface ServerEventItem {
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ServerEvent {
  type: string;
  delta?: string;
  text?: string;
  transcript?: string;
  call_id?: string;
  item_id?: string;
  name?: string;
  arguments?: string;
  item?: ServerEventItem;
  error?: ServerError;
}

export interface OpenAIRealtimeClientOptions {
  apiEndpoint?: string;
  debug?: boolean;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
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
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private lipSyncInterval: number | null = null;
  private isResponseInProgress = false;
  private cancelInFlight = false;
  private hasStartedAssistantResponse = false;
  private hasStartedAudioOutput = false;
  private assistantText = "";
  private eventCallbacks = new Set<(event: RealtimeTransportEvent) => void>();

  constructor(private options: OpenAIRealtimeClientOptions = {}) {}

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    try {
      this.log("Starting OpenAI Realtime WebRTC connection");

      this.pc = new RTCPeerConnection();
      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;

      this.pc.ontrack = (event) => {
        if (this.audioElement) {
          this.audioElement.srcObject = event.streams[0];
        }
        this.setupAudioAnalysis(event.streams[0]);
      };

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const audioTrack = this.mediaStream.getTracks()[0];
        this.pc.addTrack(audioTrack, this.mediaStream);
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

      if (
        bootstrap.adapter !== OPENAI_REALTIME_ADAPTER ||
        bootstrap.transport !== "webrtc" ||
        !("answerSdp" in bootstrap)
      ) {
        throw new Error(
          `OpenAI realtime client only supports ${OPENAI_REALTIME_ADAPTER} bootstrap, received ${bootstrap.adapter}/${bootstrap.transport}`,
        );
      }

      await this.pc.setRemoteDescription({
        type: "answer",
        sdp: bootstrap.answerSdp,
      });

      this.emitEvent({ type: "session.started" });
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.log("Disconnecting OpenAI Realtime WebRTC");
    this.cleanup();
  }

  async sendText(text: string): Promise<void> {
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
    console.warn(
      "sendAudio is not needed with WebRTC - audio is automatically transmitted",
    );
  }

  async sendToolResult(
    callId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
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
      case "session.updated":
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
        this.emitEvent({
          type: "assistant.response.completed",
          text: this.assistantText,
        });
        this.resetResponseTracking();
        return;

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        if (this.cancelInFlight || !event.delta) {
          return;
        }

        if (!this.hasStartedAssistantResponse) {
          this.hasStartedAssistantResponse = true;
          this.emitEvent({ type: "assistant.response.started" });
        }

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

        if (!this.hasStartedAssistantResponse) {
          this.hasStartedAssistantResponse = true;
          this.emitEvent({ type: "assistant.response.started" });
        }

        if (event.text !== this.assistantText) {
          const delta = event.text.startsWith(this.assistantText)
            ? event.text.slice(this.assistantText.length)
            : event.text;

          this.assistantText = event.text;
          if (delta) {
            this.emitEvent({
              type: "assistant.text.delta",
              text: delta,
            });
          }
        }
        return;

      case "response.output_audio_transcript.done":
        if (this.cancelInFlight || !event.transcript) {
          return;
        }

        if (!this.hasStartedAssistantResponse) {
          this.hasStartedAssistantResponse = true;
          this.emitEvent({ type: "assistant.response.started" });
        }

        if (event.transcript !== this.assistantText) {
          const delta = event.transcript.startsWith(this.assistantText)
            ? event.transcript.slice(this.assistantText.length)
            : event.transcript;

          this.assistantText = event.transcript;
          if (delta) {
            this.emitEvent({
              type: "assistant.text.delta",
              text: delta,
            });
          }
        }
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
        this.emitEvent({
          type: "error",
          error: new Error(event.error?.message || "Unknown error"),
        });
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

  private setupAudioAnalysis(stream: MediaStream): void {
    try {
      const audioContextConstructor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!audioContextConstructor) {
        throw new Error("AudioContext is not supported in this browser");
      }

      this.audioContext = new audioContextConstructor();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

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

  private cleanup(): void {
    this.stopLipSyncAnalysis();

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

    this.analyser = null;
    this.isResponseInProgress = false;
    this.cancelInFlight = false;
    this.resetResponseTracking();
  }

  private beginResponseRequest(): void {
    this.resetResponseTracking();
    this.isResponseInProgress = true;
    this.cancelInFlight = false;
  }

  private requireOpenDataChannel(): RTCDataChannel {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel not ready");
    }

    return this.dc;
  }

  private resetResponseTracking(): void {
    this.assistantText = "";
    this.hasStartedAssistantResponse = false;
    this.hasStartedAudioOutput = false;
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
