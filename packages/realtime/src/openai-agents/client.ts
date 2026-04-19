import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";
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

export class OpenAIRealtimeAgentsClient implements RealtimeTransportClient {
  private session: RealtimeSession | null = null;
  private transport: OpenAIRealtimeWebRTC | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private connectionWasActive = false;
  private assistant: AssistantState = { text: "", started: false };
  private latestHistory: RealtimeItem[] = [];
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
      this.log("Starting OpenAI Agents Realtime WebRTC connection");

      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;
      this.audioElement.setAttribute("playsinline", "true");

      const agent = new RealtimeAgent({
        name: "charivo-realtime-agent",
        instructions: resolveInstructions(config),
        tools: this.createProxyTools(config?.tools),
        voice: resolveVoice(config),
      });

      this.transport = new OpenAIRealtimeWebRTC(
        this.createTransportOptions(this.audioElement),
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
      this.lipSyncAnalyzer.stopOutput();
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
  ): OpenAIRealtimeWebRTCOptions {
    return {
      audioElement,
      changePeerConnection: async (peerConnection) => {
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

  private cleanup(error?: unknown): void {
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

    this.latestHistory = [];
    this.resetAssistantTracking();
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
