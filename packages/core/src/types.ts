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
}

export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  characterId?: string;
  type: "user" | "character" | "system";
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
    character?: Character,
  ): Promise<string>;
  setCharacter?(character: Character): void;
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

export interface Renderer {
  render(message: Message, character?: Character): Promise<void>;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
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
}

// TTS 제공자 (오디오 데이터 생성)
export interface TTSProvider {
  generateSpeech(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  setVoice(voice: string): void;
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
  error: { error: Error };
};
