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

export interface TTSAdapter {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setVoice(voiceId: string): void;
  getAvailableVoices(): Promise<SpeechSynthesisVoice[]>;
  isSupported(): boolean;
}

export type EventMap = {
  "message:sent": { message: Message };
  "message:received": { message: Message };
  "character:speak": { character: Character; message: string };
  "tts:start": { text: string; characterId?: string };
  "tts:end": { characterId?: string };
  "tts:error": { error: Error };
  error: { error: Error };
};
