import type { RealtimeState } from "@charivo/core";

export type {
  Character,
  CharivoEventEmitter,
  RealtimeConnectionState,
  RealtimeManager,
  RealtimeProvider,
  RealtimeResponseStatus,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
  RealtimeSessionStatus,
  RealtimeState,
  RealtimeTool,
  RealtimeToolChoice,
  RealtimeTransportKind,
} from "@charivo/core";

export type RealtimeTransportEvent =
  | { type: "session.started" }
  | { type: "session.ended" }
  | { type: "user.transcript"; text: string }
  | { type: "assistant.response.started" }
  | { type: "assistant.text.delta"; text: string }
  | { type: "assistant.response.completed"; text: string }
  | { type: "audio.output.started" }
  | { type: "audio.output.ended" }
  | { type: "audio.lipsync"; rms: number }
  | {
      type: "tool.call";
      name: string;
      args: Record<string, unknown>;
      callId?: string;
    }
  | {
      type: "tool.result";
      name: string;
      output: Record<string, unknown>;
      callId?: string;
    }
  | { type: "state"; state: Partial<RealtimeState> }
  | { type: "error"; error: Error };

export interface RealtimeTransportClient {
  connect(
    config?: import("@charivo/core").RealtimeSessionConfig,
  ): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(audio: ArrayBuffer): Promise<void>;
  interrupt(): Promise<void>;
  onEvent(callback: (event: RealtimeTransportEvent) => void): void;
}

export type RealtimeClient = RealtimeTransportClient;
