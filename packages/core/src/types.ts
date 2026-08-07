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

// Modality-neutral tool contracts (used by realtime and LLM sessions)
export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  /**
   * JSON Schema-shaped. `validateToolArguments` only enforces required-key
   * presence, enum membership, and each property's top-level `type`; nested
   * schemas, `additionalProperties`, and numeric-length constraints are not
   * validated.
   */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  character?: Character | null;
  callId?: string;
  /** Present only for realtime sessions. */
  state?: RealtimeState;
}

/** Must resolve to a plain object; arrays and primitives are rejected by the runners. */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<Record<string, unknown>>;

export interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
  /** Timeout in ms; falls back to the manager default when omitted. */
  timeoutMs?: number;
}

export interface ToolResultProjectorContext {
  name: string;
  output: Record<string, unknown>;
  callId?: string;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}

export type ToolResultProjector = (context: ToolResultProjectorContext) => void;

export interface RealtimeSessionConfig {
  provider?: string;
  transport?: RealtimeTransportKind;
  voice?: string;
  model?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: RealtimeToolChoice;
  inputAudioTranscription?: {
    model?: string;
    enabled?: boolean;
  };
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

export type RealtimeReconnectCause =
  | "ice-disconnected"
  | "ice-failed"
  | "connection-failed"
  | "offline"
  | "online"
  | "visibility"
  | "pagehide"
  | "pageshow";

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

export interface RealtimeUsageEvent {
  usage: Record<string, unknown>;
  model?: string;
  responseId?: string;
  sessionId?: string;
}

export interface LLMAdapter {
  generateResponse(message: Message): Promise<string>;
  setCharacter(character: Character): void;
  clearHistory(): void;
}

export interface LLMToolCall {
  id: string;
  name: string;
  /** JSON-decoded; the provider/client adapter parses the raw tool-call arguments before this contract is used. */
  arguments: Record<string, unknown>;
}

/**
 * Role-discriminated union so protocol-invalid combinations are unrepresentable
 * for typed direct callers: unknown roles, tool turns without an ID, and tool
 * calls on user turns cannot be expressed.
 */
export type LLMMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export interface LLMToolResponse {
  content: string;
  toolCalls?: LLMToolCall[];
}

// LLM provider (generates LLM responses server-side)
export interface LLMProvider {
  generateResponse(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string>;
  /** Tool-calling variant; providers that support function calling implement this alongside generateResponse. */
  generateResponseWithTools?(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse>;
}

// Simple LLM call client (stateless)
export interface LLMClient {
  call(messages: Array<{ role: string; content: string }>): Promise<string>;
  /** Tool-calling variant; clients that support function calling implement this alongside call. */
  callWithTools?(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse>;
}

// LLM manager (session management, history, character management)
export interface LLMManager {
  setCharacter(character: Character): void;
  getCharacter(): Character | null;
  clearHistory(): void;
  getHistory(): Message[];
  generateResponse(message: Message): Promise<string>;
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
  registerTool?(tool: ToolRegistration): void;
  unregisterTool?(name: string): void;
  getRegisteredTools?(): ToolDefinition[];
  /** System-prompt-level instructions injected only when tools are registered; pass null to clear. */
  setToolInstructions?(instructions: string | null): void;
}

/**
 * `LLMManager` with the tool-calling members required instead of optional.
 * Third-party `LLMManager` implementations may omit tool support, but the
 * built-in manager returned by `createLLMManager` always provides it.
 */
export interface LLMManagerWithTools extends LLMManager {
  setEventEmitter(eventEmitter: CharivoEventEmitter): void;
  registerTool(tool: ToolRegistration): void;
  unregisterTool(name: string): void;
  getRegisteredTools(): ToolDefinition[];
  setToolInstructions(instructions: string | null): void;
}

// Renderer interface (stateless renderer)
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

// Render manager (session management, lip-sync, motion control)
export interface RenderManager {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  setCharacter(character: Character): void;
  render(message: Message, character?: Character): Promise<void>;
  /** Local-presence gaze (webcam), peer of mouse-tracking. Returns true when applied. */
  setLocalGaze?(coords: GazeCoordinates): boolean;
  setEventBus(eventBus: CharivoEventBus): void;
  /** Removes all event-bus listeners registered by setEventBus. */
  disconnect(): void;
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

// TTS player (plays audio in the browser)
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
  /**
   * Stateless audio generation. Required for the `"audio"` playback mode: the
   * manager creates the audio element itself so it can analyze playback for
   * lip-sync. Players that can only `speak()` must use `"web-speech"` mode.
   */
  generateAudio?(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
}

// TTS provider (generates audio data)
export interface TTSProvider {
  generateSpeech(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  setVoice(voice: string): void;
}

// TTS Manager - interface responsible for managing the state of a TTS session
export interface TTSManager {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  /** Creates the audio analysis context up front; call from a user gesture handler so browsers allow playback later. */
  prepareAudio?(): Promise<void>;
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
  /** Final resource release; call stop() first - dispose() does not stop playback. */
  dispose?(): Promise<void>;
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
  /** Optional: subscribe to cumulative interim transcript snapshots (streaming transcribers only). */
  onPartial?(callback: (transcription: string) => void): void;
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
  prepareAudio?(config?: RealtimeSessionConfig): Promise<void>;
  startSession(config?: RealtimeSessionConfig): Promise<void>;
  updateSession(config?: RealtimeSessionConfig): Promise<void>;
  stopSession(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendAudioChunk(audio: ArrayBuffer): Promise<void>;
  interrupt(): Promise<void>;
  registerTool(tool: ToolRegistration): void;
  unregisterTool(name: string): void;
  getRegisteredTools(): ToolDefinition[];
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

export type EventMap = {
  "message:sent": { message: Message };
  "message:received": { message: Message };
  "character:speak": { character: Character; message: string };
  "tts:start": { text: string; characterId?: string };
  "tts:end": { characterId?: string };
  "tts:error": { error: Error };
  "tts:audio:start": { characterId?: string };
  "tts:audio:end": { characterId?: string };
  "tts:lipsync:update": { rms: number; characterId?: string };
  "stt:start": { options?: STTOptions };
  "stt:partial": { text: string };
  "stt:stop": { text: string };
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
  "realtime:reconnect:attempt": {
    attempt: number;
    delayMs: number;
    cause: RealtimeReconnectCause;
  };
  "realtime:reconnect:success": {
    attempts: number;
    totalMs: number;
    cause: RealtimeReconnectCause;
  };
  "realtime:reconnect:exhausted": {
    attempts: number;
    totalMs: number;
    cause: RealtimeReconnectCause;
    lastError: Error;
  };
  "realtime:usage": RealtimeUsageEvent;
  "avatar:expression": { expressionId: string };
  "avatar:motion": { group: string; index: number };
  "avatar:gaze": GazeCoordinates;
  "realtime:error": { error: Error };
  "llm:error": { error: Error };
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
