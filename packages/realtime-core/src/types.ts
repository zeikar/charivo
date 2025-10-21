/**
 * Realtime API Types
 */

export interface RealtimeSessionConfig {
  voice?: string;
  model?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface RealtimeClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(audio: ArrayBuffer): Promise<void>;
  onTextDelta(callback: (text: string) => void): void;
  onAudioDelta(callback: (base64Audio: string) => void): void;
  onLipSyncUpdate?(callback: (rms: number) => void): void; // Optional: Direct RMS callback for WebRTC
  onAudioDone(callback: () => void): void;
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
