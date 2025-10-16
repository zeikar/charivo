/**
 * Standard emotion types for character expressions
 */
export enum Emotion {
  NEUTRAL = "neutral",
  HAPPY = "happy",
  SAD = "sad",
  ANGRY = "angry",
  SURPRISED = "surprised",
  THINKING = "thinking",
  EXCITED = "excited",
  SHY = "shy",
}

/**
 * Mapping between emotion and Live2D model animations
 */
export interface EmotionMapping {
  emotion: Emotion;
  expression?: string; // Live2D expression ID (e.g., "smile", "angry")
  motion?: {
    group: string; // Live2D motion group (e.g., "Idle", "TapBody")
    index?: number; // Motion index within group
  };
}

export interface Character {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  avatar?: string;
  voice?: {
    voiceId?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  };
  /**
   * Custom emotion mappings for this character's Live2D model
   * If not specified, default mappings will be used
   */
  emotionMappings?: EmotionMapping[];
}

export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  characterId?: string;
  type: "user" | "character" | "system";
  /**
   * Parsed emotion from message content (if any)
   */
  emotion?: Emotion;
}

export interface Conversation {
  id: string;
  messages: Message[];
  characterId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export interface CharivoConfig {
  characters: Character[];
  plugins: Plugin[];
  llmProvider?: string;
  renderProvider?: string;
}

export interface LLMAdapter {
  generateResponse(message: Message): Promise<string>;
  setCharacter(character: Character): void;
  clearHistory(): void;
}

// LLM 제공자 (서버사이드에서 LLM 응답 생성)
export interface LLMProvider {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>;
}

// 단순한 LLM 호출 클라이언트 (stateless)
export interface LLMClient {
  call(messages: Array<{ role: string; content: string }>): Promise<string>;
}

// LLM 매니저 (세션 관리, 히스토리, 캐릭터 관리)
export interface LLMManager {
  setCharacter(character: Character): void;
  getCharacter(): Character | null;
  clearHistory(): void;
  getHistory(): Message[];
  generateResponse(message: Message): Promise<string>;
}

// Renderer 인터페이스 (stateless renderer)
export interface Renderer {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  render(message: Message, character?: Character): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
  setRealtimeLipSync?(enabled: boolean): void;
  updateRealtimeLipSyncRms?(rms: number): void;
}

// Render 매니저 (세션 관리, 립싱크, 모션 제어)
export interface RenderManager {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  setCharacter(character: Character): void;
  render(message: Message, character?: Character): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
  setMessageCallback?(
    callback: (message: Message, character?: Character) => void,
  ): void;
}

export interface TTSOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string;
}

// TTS 플레이어 (브라우저에서 음성 재생)
export interface TTSPlayer {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  // Stateless audio generation (optional)
  generateAudio?(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
}

// TTS 제공자 (오디오 데이터 생성)
export interface TTSProvider {
  generateSpeech(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  setVoice(voice: string): void;
}

// TTS Manager - TTS 세션의 상태 관리를 담당하는 인터페이스
export interface TTSManager {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  setEventEmitter?(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void;
}

export interface STTOptions {
  language?: string;
}

// STT provider (converts audio data to text)
export interface STTProvider {
  transcribe(audio: Blob | ArrayBuffer, options?: STTOptions): Promise<string>;
}

// STT transcriber (browser-side audio transcription)
export interface STTTranscriber {
  transcribe(audio: Blob | ArrayBuffer, options?: STTOptions): Promise<string>;
}

// STT Manager - Manages STT session state
export interface STTManager {
  start(options?: STTOptions): Promise<void>;
  stop(): Promise<string>;
  isRecording(): boolean;
  setEventEmitter?(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void;
}

export type EventMap = {
  "message:sent": { message: Message };
  "message:received": { message: Message };
  "character:speak": { character: Character; message: string };
  "tts:start": { text: string; characterId?: string };
  "tts:end": { characterId?: string };
  "tts:error": { error: Error };
  "tts:audio:start": { audioElement: HTMLAudioElement; characterId?: string };
  "tts:audio:end": { characterId?: string };
  "tts:lipsync:update": { rms: number; characterId?: string };
  "stt:start": { options?: STTOptions };
  "stt:stop": { transcription: string };
  "stt:error": { error: Error };
  error: { error: Error };
};
