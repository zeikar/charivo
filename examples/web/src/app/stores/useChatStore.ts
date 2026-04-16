import { create } from "zustand";
import type {
  AvatarControlCatalog,
  Charivo,
  RealtimeState,
} from "@charivo/core";
import type {
  ChatMessage,
  LLMClientType,
  RealtimeTurnStatus,
  TTSPlayerType,
  STTTranscriberType,
} from "../types/chat";

type ChatStore = {
  // Charivo instance
  charivo: Charivo | null;
  setCharivo: (charivo: Charivo | null) => void;

  // Messages
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;

  // Input
  input: string;
  setInput: (input: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  isSpeaking: boolean;
  setIsSpeaking: (speaking: boolean) => void;
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  isTranscribing: boolean;
  setIsTranscribing: (transcribing: boolean) => void;

  // Client selections
  selectedLLMClient: LLMClientType;
  setSelectedLLMClient: (type: LLMClientType) => void;
  selectedTTSPlayer: TTSPlayerType;
  setSelectedTTSPlayer: (type: TTSPlayerType) => void;
  selectedSTTTranscriber: STTTranscriberType;
  setSelectedSTTTranscriber: (type: STTTranscriberType) => void;

  // Errors
  llmError: string | null;
  setLlmError: (error: string | null) => void;
  ttsError: string | null;
  setTtsError: (error: string | null) => void;
  sttError: string | null;
  setSttError: (error: string | null) => void;

  // Realtime mode
  isRealtimeMode: boolean;
  setIsRealtimeMode: (mode: boolean) => void;
  isConnecting: boolean;
  setIsConnecting: (connecting: boolean) => void;
  isConnected: boolean;
  setIsConnected: (connected: boolean) => void;
  realtimeError: string | null;
  setRealtimeError: (error: string | null) => void;
  realtimeState: RealtimeState | null;
  setRealtimeState: (state: RealtimeState | null) => void;
  realtimeAssistantDraft: string | null;
  setRealtimeAssistantDraft: (draft: string | null) => void;
  appendRealtimeAssistantDraft: (chunk: string) => void;
  realtimeTurnStatus: RealtimeTurnStatus;
  setRealtimeTurnStatus: (status: RealtimeTurnStatus) => void;
  avatarCatalog: AvatarControlCatalog;
  setAvatarCatalog: (catalog: AvatarControlCatalog) => void;
  avatarDebug: {
    lastToolCall: {
      name: string;
      callId?: string;
      args: Record<string, unknown>;
      at: number;
    } | null;
    lastToolResult: {
      name: string;
      callId?: string;
      output: Record<string, unknown>;
      appliedActions: Record<string, unknown> | null;
      at: number;
    } | null;
    lastExpression: { expressionId: string; at: number } | null;
    lastMotion: { group: string; index: number; at: number } | null;
    lastGaze: { x: number; y: number; at: number } | null;
  };
  setAvatarDebug: (debugPatch: Partial<ChatStore["avatarDebug"]>) => void;
  resetAvatarDebug: () => void;
  resetRealtimeUiState: () => void;
};

const initialAvatarDebugState: ChatStore["avatarDebug"] = {
  lastToolCall: null,
  lastToolResult: null,
  lastExpression: null,
  lastMotion: null,
  lastGaze: null,
};

export const useChatStore = create<ChatStore>((set) => ({
  // Charivo instance
  charivo: null,
  setCharivo: (charivo) => set({ charivo }),

  // Messages
  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),

  // Input
  input: "",
  setInput: (input) => set({ input }),

  // Loading states
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),
  isSpeaking: false,
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  isRecording: false,
  setIsRecording: (isRecording) => set({ isRecording }),
  isTranscribing: false,
  setIsTranscribing: (isTranscribing) => set({ isTranscribing }),

  // Client selections
  selectedLLMClient: "remote",
  setSelectedLLMClient: (selectedLLMClient) => set({ selectedLLMClient }),
  selectedTTSPlayer: "remote",
  setSelectedTTSPlayer: (selectedTTSPlayer) => set({ selectedTTSPlayer }),
  selectedSTTTranscriber: "remote",
  setSelectedSTTTranscriber: (selectedSTTTranscriber) =>
    set({ selectedSTTTranscriber }),

  // Errors
  llmError: null,
  setLlmError: (llmError) => set({ llmError }),
  ttsError: null,
  setTtsError: (ttsError) => set({ ttsError }),
  sttError: null,
  setSttError: (sttError) => set({ sttError }),

  // Realtime mode
  isRealtimeMode: false,
  setIsRealtimeMode: (isRealtimeMode) => set({ isRealtimeMode }),
  isConnecting: false,
  setIsConnecting: (isConnecting) => set({ isConnecting }),
  isConnected: false,
  setIsConnected: (isConnected) => set({ isConnected }),
  realtimeError: null,
  setRealtimeError: (realtimeError) => set({ realtimeError }),
  realtimeState: null,
  setRealtimeState: (realtimeState) => set({ realtimeState }),
  realtimeAssistantDraft: null,
  setRealtimeAssistantDraft: (realtimeAssistantDraft) =>
    set({ realtimeAssistantDraft }),
  appendRealtimeAssistantDraft: (chunk) =>
    set((state) => ({
      realtimeAssistantDraft: `${state.realtimeAssistantDraft ?? ""}${chunk}`,
    })),
  realtimeTurnStatus: "idle",
  setRealtimeTurnStatus: (realtimeTurnStatus) => set({ realtimeTurnStatus }),
  avatarCatalog: { expressions: [], motions: {} },
  setAvatarCatalog: (avatarCatalog) => set({ avatarCatalog }),
  avatarDebug: initialAvatarDebugState,
  setAvatarDebug: (debugPatch) =>
    set((state) => ({
      avatarDebug: {
        ...state.avatarDebug,
        ...debugPatch,
      },
    })),
  resetAvatarDebug: () => set({ avatarDebug: initialAvatarDebugState }),
  resetRealtimeUiState: () =>
    set({
      realtimeAssistantDraft: null,
      realtimeTurnStatus: "idle",
    }),
}));
