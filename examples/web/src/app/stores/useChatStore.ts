import { create } from "zustand";
import type { Charivo } from "@charivo/core";
import type {
  ChatMessage,
  LLMClientType,
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
}));
