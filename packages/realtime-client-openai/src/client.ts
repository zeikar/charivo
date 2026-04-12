import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import type {
  RealtimeTransportClient,
  RealtimeTransportEvent,
} from "@charivo/realtime-core";

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

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * OpenAI-specific realtime transport client.
 *
 * This package normalizes OpenAI Realtime WebRTC events into the transport
 * event contract defined by `@charivo/realtime-core`.
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
  private hasStartedAssistantResponse = false;
  private hasStartedAudioOutput = false;
  private assistantText = "";
  private eventCallback?: (event: RealtimeTransportEvent) => void;

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

      if (bootstrap.transport !== "webrtc") {
        throw new Error(
          `OpenAI realtime client only supports WebRTC bootstrap, received ${bootstrap.transport}`,
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
    this.emitEvent({ type: "session.ended" });
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

    this.resetResponseTracking();
    this.isResponseInProgress = true;
  }

  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    console.warn(
      "sendAudio is not needed with WebRTC - audio is automatically transmitted",
    );
  }

  async interrupt(): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel not ready");
    }

    if (!this.isResponseInProgress) {
      return;
    }

    this.dc.send(JSON.stringify({ type: "response.cancel" }));
    this.isResponseInProgress = false;
    this.resetResponseTracking();
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallback = callback;
  }

  private handleServerEvent(event: ServerEvent): void {
    if (this.options.debug && !event.type.includes("audio.delta")) {
      this.log("📡 [OpenAI Realtime Event]", event.type, event);
    }

    switch (event.type) {
      case "session.created":
      case "session.updated":
        return;

      case "response.audio.delta":
        if (!this.hasStartedAudioOutput) {
          this.hasStartedAudioOutput = true;
          this.emitEvent({ type: "audio.output.started" });
        }
        return;

      case "response.audio.done":
        this.emitEvent({ type: "audio.output.ended" });
        this.hasStartedAudioOutput = false;
        return;

      case "response.done":
        this.isResponseInProgress = false;
        this.emitEvent({
          type: "assistant.response.completed",
          text: this.assistantText,
        });
        this.resetResponseTracking();
        return;

      case "response.audio_transcript.delta":
        if (!event.delta) {
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
    const callId =
      (event.call_id as string | undefined) ||
      (event.item?.call_id as string | undefined) ||
      (event.item_id as string | undefined);
    const name =
      (event.name as string | undefined) ||
      (event.item?.name as string | undefined);
    const argsJson =
      (event.arguments as string | undefined) ||
      (event.item?.arguments as string | undefined);

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

    if (!callId || !this.dc || this.dc.readyState !== "open") {
      return;
    }

    const output = { success: true };
    this.dc.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    );
    this.dc.send(JSON.stringify({ type: "response.create" }));

    this.emitEvent({
      type: "tool.result",
      name,
      output,
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
      `Realtime session request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Realtime session: ${errorText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const bootstrap = (await response.json()) as unknown;
      if (!isRealtimeSessionBootstrap(bootstrap)) {
        throw new Error("Invalid realtime session bootstrap response");
      }
      return bootstrap;
    }

    const answerSdp = await response.text();
    return {
      transport: "webrtc",
      answerSdp,
    };
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
    this.resetResponseTracking();
  }

  private resetResponseTracking(): void {
    this.assistantText = "";
    this.hasStartedAssistantResponse = false;
    this.hasStartedAudioOutput = false;
  }

  private emitEvent(event: RealtimeTransportEvent): void {
    this.eventCallback?.(event);
  }

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log(...args);
    }
  }
}

export function createOpenAIRealtimeClient(
  options?: OpenAIRealtimeClientOptions,
): RealtimeTransportClient {
  return new OpenAIRealtimeClient(options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRealtimeSessionBootstrap(
  value: unknown,
): value is RealtimeSessionBootstrap {
  if (!isRecord(value) || typeof value.transport !== "string") {
    return false;
  }

  if (value.transport === "webrtc") {
    return typeof value.answerSdp === "string";
  }

  if (value.transport === "websocket") {
    return typeof value.url === "string" && typeof value.token === "string";
  }

  return false;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
