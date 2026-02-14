/**
 * Realtime API Types
 */

export interface RealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface RealtimeSessionConfig {
  voice?: string;
  model?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: RealtimeTool[];
  tool_choice?: "auto" | "none" | "required";
}

export interface RealtimeClient {
  connect(config?: RealtimeSessionConfig): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(audio: ArrayBuffer): Promise<void>;
  onTextDelta(callback: (text: string) => void): void;
  onAudioDelta(callback: (base64Audio: string) => void): void;
  onLipSyncUpdate?(callback: (rms: number) => void): void; // Optional: Direct RMS callback for WebRTC
  onAudioDone(callback: () => void): void;
  onToolCall?(callback: (name: string, args: any) => void): void;
  onError(callback: (error: Error) => void): void;
}

export interface RealtimeManager {
  startSession(config: RealtimeSessionConfig): Promise<void>;
  stopSession(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendAudioChunk(audio: ArrayBuffer): Promise<void>;
  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void;
}
