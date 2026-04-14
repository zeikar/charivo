import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
  isRecord,
} from "@charivo/shared";
import type {
  RealtimeTransportClient,
  RealtimeTransportEvent,
} from "@charivo/realtime-core";
import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type OpenAIRealtimeWebRTCOptions,
  type RealtimeItem,
  type TransportLayerTranscriptDelta,
} from "@openai/agents-realtime";

interface PendingToolCall {
  name: string;
  resolve: (output: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface AssistantState {
  text: string;
  started: boolean;
}

interface AgentsToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: true;
}

export interface OpenAIRealtimeAgentsClientOptions {
  apiEndpoint?: string;
  debug?: boolean;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
}

const DEBUG_EVENT_ALLOWLIST = new Set([
  "conversation.item.input_audio_transcription.completed",
  "error",
]);

const TOOL_RESULT_TIMEOUT_MESSAGE =
  "Realtime session ended before tool result was returned";

export class OpenAIRealtimeAgentsClient implements RealtimeTransportClient {
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebRTC | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private audioAnalysisStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private lipSyncInterval: number | null = null;
  private pendingAudioElementPoll: number | null = null;
  private connectionWasActive = false;
  private assistant: AssistantState = { text: "", started: false };
  private latestHistory: RealtimeItem[] = [];
  private readonly eventCallbacks = new Set<
    (event: RealtimeTransportEvent) => void
  >();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  constructor(private options: OpenAIRealtimeAgentsClientOptions = {}) {}

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    try {
      this.log("Starting OpenAI Agents Realtime WebRTC connection");

      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute("playsinline", "true");

      const agent = new RealtimeAgent({
        name: "charivo-realtime-agent",
        instructions:
          config?.instructions ??
          "You are a realtime voice agent controlling a Live2D character.",
        tools: this.createProxyTools(config?.tools),
        voice: config?.voice,
      });

      this.transport = new OpenAIRealtimeWebRTC(
        this.createTransportOptions(this.audioElement),
      );

      this.session = new RealtimeSession(agent, {
        transport: this.transport,
        config: this.toSessionConfig(config),
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
    this.cleanup();
  }

  async sendText(text: string): Promise<void> {
    if (!this.session) {
      throw new Error("Realtime session not active");
    }

    this.resetAssistantTracking();
    this.session.sendMessage(text);
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
    const pendingCall = this.pendingToolCalls.get(callId);

    if (!pendingCall) {
      throw new Error(`No pending realtime tool call for "${callId}"`);
    }

    this.pendingToolCalls.delete(callId);
    pendingCall.resolve(output);
  }

  async interrupt(): Promise<void> {
    if (!this.session) {
      throw new Error("Realtime session not active");
    }

    this.session.interrupt();
    this.assistant.started = false;
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
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
      this.emitEvent({ type: "audio.lipsync", rms: 0 });
    });

    transport.on("connection_change", (status) => {
      if (status === "disconnected" && this.connectionWasActive) {
        this.cleanupPendingToolCalls();
        this.connectionWasActive = false;
        this.emitEvent({ type: "session.ended" });
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
    return (tools ?? []).map((definition) =>
      tool({
        name: definition.name,
        description: definition.description,
        parameters: toAgentsToolParameters(definition.parameters),
        strict: false,
        needsApproval: false,
        execute: async (input, _context, details) => {
          const toolCallItem = details?.toolCall as
            | { callId?: string }
            | undefined;
          const callId =
            toolCallItem?.callId ??
            (typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${definition.name}-${Date.now()}`);

          return await new Promise<Record<string, unknown>>(
            (resolve, reject) => {
              this.pendingToolCalls.set(callId, {
                name: definition.name,
                resolve,
                reject,
              });

              this.emitEvent({
                type: "tool.call",
                name: definition.name,
                args: isRecord(input) ? input : {},
                callId,
              });
            },
          );
        },
      }),
    );
  }

  private toSessionConfig(
    config?: RealtimeSessionConfig,
  ): Record<string, unknown> {
    return {
      model: config?.model ?? "gpt-realtime-mini",
      instructions: config?.instructions ?? "",
      toolChoice: config?.toolChoice ?? "auto",
      outputModalities: ["audio"],
      voice: config?.voice ?? "marin",
      audio: {
        output: {
          voice: config?.voice ?? "marin",
        },
      },
    };
  }

  private createTransportOptions(
    audioElement: HTMLAudioElement,
  ): OpenAIRealtimeWebRTCOptions {
    return {
      audioElement,
      changePeerConnection: async (peerConnection) => {
        peerConnection.addEventListener("track", (event) => {
          const stream = event.streams[0];
          if (stream) {
            this.trySetupAudioAnalysis(stream);
          }
        });
        return peerConnection;
      },
    };
  }

  private observeAudioElement(audioElement: HTMLAudioElement): void {
    const tryAttachStream = () => {
      const stream = audioElement.srcObject;
      if (stream instanceof MediaStream) {
        this.trySetupAudioAnalysis(stream);
      }
    };

    audioElement.addEventListener("loadedmetadata", tryAttachStream);
    this.pendingAudioElementPoll = window.setInterval(tryAttachStream, 50);
  }

  private trySetupAudioAnalysis(stream: MediaStream): void {
    if (this.audioAnalysisStream === stream) {
      return;
    }

    this.stopAudioElementPolling();
    this.stopLipSyncAnalysis();
    this.audioAnalysisStream = stream;

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

  private resetAssistantTracking(): void {
    this.assistant = {
      text: "",
      started: false,
    };
  }

  private cleanup(error?: unknown): void {
    this.cleanupPendingToolCalls(error);
    this.stopLipSyncAnalysis();
    this.stopAudioElementPolling();

    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }

    if (this.session) {
      this.session.close();
      this.session = null;
    }

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    if (this.audioElement) {
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    this.analyser = null;
    this.audioAnalysisStream = null;
    this.latestHistory = [];
    this.resetAssistantTracking();
  }

  private cleanupPendingToolCalls(error?: unknown): void {
    const toolError =
      error instanceof Error ? error : new Error(TOOL_RESULT_TIMEOUT_MESSAGE);

    for (const pendingCall of this.pendingToolCalls.values()) {
      pendingCall.reject(toolError);
    }

    this.pendingToolCalls.clear();
  }

  private stopAudioElementPolling(): void {
    if (this.pendingAudioElementPoll) {
      clearInterval(this.pendingAudioElementPoll);
      this.pendingAudioElementPoll = null;
    }
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
        "OpenAI agents realtime client requires apiEndpoint or sessionBootstrap",
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

    return bootstrap;
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

    console.debug("[charivo/realtime-client-openai-agents]", ...args);
  }
}

export function createOpenAIRealtimeAgentsClient(
  options?: OpenAIRealtimeAgentsClientOptions,
): RealtimeTransportClient {
  return new OpenAIRealtimeAgentsClient(options);
}

function toAgentsToolParameters(
  parameters: NonNullable<RealtimeSessionConfig["tools"]>[number]["parameters"],
): AgentsToolParameters {
  return {
    ...parameters,
    required: parameters.required ?? [],
    additionalProperties: true,
  };
}
