export interface MotionSelection {
  group: string;
  index?: number;
}

export interface GazeCoordinates {
  x: number;
  y: number;
}

export interface AvatarControlCatalog {
  expressions: string[];
  motions: Record<string, number>;
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

export type RealtimeTransportKind = "webrtc" | "websocket";

export type RealtimeToolChoice = "auto" | "none" | "required";
export const OPENAI_REALTIME_ADAPTER = "openai-webrtc";
export const OPENAI_REALTIME_AGENTS_ADAPTER = "openai-agents-webrtc";

export interface RealtimeTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface RealtimeSessionConfig {
  provider?: string;
  transport?: RealtimeTransportKind;
  voice?: string;
  model?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: RealtimeTool[];
  toolChoice?: RealtimeToolChoice;
}

export interface RealtimeSessionRequest {
  adapter?: string;
  transport: RealtimeTransportKind;
  session: RealtimeSessionConfig;
  sdpOffer?: string;
}

export type RealtimeSessionBootstrap =
  | {
      adapter: string;
      transport: "webrtc";
      answerSdp: string;
    }
  | {
      adapter: string;
      transport: "webrtc";
      clientSecret: string;
    }
  | {
      adapter: string;
      transport: "websocket";
      url: string;
      token: string;
    };

export interface RealtimeProvider {
  createSession(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap>;
}

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export type RealtimeSessionStatus = "idle" | "starting" | "active" | "stopped";
export type RealtimeSessionTransitionReason = "user" | "refresh";

export type RealtimeResponseStatus =
  | "idle"
  | "responding"
  | "interrupted"
  | "completed";

export interface RealtimeState {
  connection: RealtimeConnectionState;
  session: {
    status: RealtimeSessionStatus;
    config: RealtimeSessionConfig | null;
    characterId?: string;
  };
  response: {
    status: RealtimeResponseStatus;
    text: string;
  };
  lastError: Error | null;
}

export interface RealtimeToolContext {
  character?: Character | null;
  state: RealtimeState;
  callId?: string;
}

export type RealtimeToolHandler = (
  args: Record<string, unknown>,
  context: RealtimeToolContext,
) => Promise<Record<string, unknown>>;

export interface RealtimeToolRegistration {
  definition: RealtimeTool;
  handler: RealtimeToolHandler;
  timeoutMs?: number;
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
  playExpression?(expressionId: string): void;
  playMotionByGroup?(group: string, index: number): void;
  lookAt?(coords: GazeCoordinates): void;
  getAvailableExpressions?(): string[];
  getAvailableMotionGroups?(): Record<string, number>;
}

// Render 매니저 (세션 관리, 립싱크, 모션 제어)
export interface RenderManager {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  setCharacter(character: Character): void;
  render(message: Message, character?: Character): Promise<void>;
  setEventBus(eventBus: CharivoEventBus): void;
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

export type TTSPlaybackMode = "audio" | "web-speech";

// TTS 플레이어 (브라우저에서 음성 재생)
export interface TTSPlayer {
  /**
   * Explicit playback mode for the manager. Prefer setting this on concrete
   * players instead of relying on constructor-name inference.
   */
  readonly playbackMode?: TTSPlaybackMode;
  /**
   * MIME type used when the manager turns generated audio into a Blob.
   */
  readonly audioMimeType?: string;
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
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

export interface STTOptions {
  language?: string;
}

// STT provider (converts audio data to text)
export interface STTProvider {
  transcribe(audio: Blob | ArrayBuffer, options?: STTOptions): Promise<string>;
}

// STT transcriber (browser-side audio transcription)
// Each transcriber handles recording internally
export interface STTTranscriber {
  startRecording(options?: STTOptions): Promise<void>;
  stopRecording(): Promise<string>;
  isRecording(): boolean;
}

// STT Manager - Manages STT session state
export interface STTManager {
  start(options?: STTOptions): Promise<void>;
  stop(): Promise<string>;
  isRecording(): boolean;
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

// Realtime Manager - Manages Realtime API session state
export interface RealtimeManager {
  setCharacter(character: Character): void;
  getState(): RealtimeState;
  startSession(config?: RealtimeSessionConfig): Promise<void>;
  updateSession(config?: RealtimeSessionConfig): Promise<void>;
  stopSession(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendAudioChunk(audio: ArrayBuffer): Promise<void>;
  interrupt(): Promise<void>;
  registerTool(tool: RealtimeToolRegistration): void;
  unregisterTool(name: string): void;
  getRegisteredTools(): RealtimeTool[];
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

export type EventMap = {
  "message:sent": { message: Message };
  "message:received": { message: Message };
  "character:speak": { character: Character; message: string };
  "tts:start": { text: string; characterId?: string };
  "tts:end": { characterId?: string };
  "tts:error": { error: Error };
  "tts:audio:start": { audioElement?: HTMLAudioElement; characterId?: string };
  "tts:audio:end": { characterId?: string };
  "tts:lipsync:update": { rms: number; characterId?: string };
  "stt:start": { options?: STTOptions };
  "stt:stop": { transcription: string };
  "stt:error": { error: Error };
  "realtime:session:start": {
    state: RealtimeState;
    reason?: RealtimeSessionTransitionReason;
  };
  "realtime:session:end": {
    state: RealtimeState;
    reason?: RealtimeSessionTransitionReason;
  };
  "realtime:state": { state: RealtimeState };
  "realtime:user:transcript": { text: string };
  "realtime:assistant:start": { state: RealtimeState };
  "realtime:assistant:delta": { text: string };
  "realtime:assistant:done": { text: string };
  "realtime:tool:call": {
    name: string;
    args: Record<string, unknown>;
    callId?: string;
  };
  "realtime:tool:result": {
    name: string;
    output: Record<string, unknown>;
    callId?: string;
  };
  "realtime:tool:error": {
    name: string;
    error: Error;
    callId?: string;
  };
  "realtime:expression": { expressionId: string };
  "realtime:motion": { group: string; index: number };
  "realtime:gaze": GazeCoordinates;
  "realtime:text:delta": { text: string };
  "realtime:error": { error: Error };
  error: { error: Error };
};

export interface CharivoEventEmitter {
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;
}

export interface CharivoEventBus extends CharivoEventEmitter {
  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
  off<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
}
