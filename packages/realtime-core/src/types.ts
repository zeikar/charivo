import type { RealtimeSessionConfig } from "@charivo/core";

export type {
  CharivoEventEmitter,
  RealtimeManager,
  RealtimeSessionConfig,
  RealtimeTool,
} from "@charivo/core";

export interface RealtimeClient {
  connect(config?: RealtimeSessionConfig): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(audio: ArrayBuffer): Promise<void>;
  onTextDelta(callback: (text: string) => void): void;
  onAudioDelta(callback: (base64Audio: string) => void): void;
  onLipSyncUpdate?(callback: (rms: number) => void): void; // Optional: Direct RMS callback for WebRTC
  onAudioDone(callback: () => void): void;
  onToolCall?(
    callback: (name: string, args: Record<string, unknown>) => void,
  ): void;
  onError(callback: (error: Error) => void): void;
}
