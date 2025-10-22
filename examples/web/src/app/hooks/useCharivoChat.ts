"use client";

import {
  useEffect,
  useCallback,
  useRef,
  type MutableRefObject,
  type KeyboardEvent,
} from "react";
import { Charivo, type Character, type Message } from "@charivo/core";
import { createTTSManager } from "@charivo/tts-core";
import { createSTTManager } from "@charivo/stt-core";
type Live2DRendererModule = typeof import("@charivo/render-live2d");
type Live2DRendererClass = Live2DRendererModule["Live2DRenderer"];
type Live2DRendererHandle = InstanceType<Live2DRendererClass>;

import type {
  LLMClientType,
  TTSPlayerType,
  STTTranscriberType,
} from "../types/chat";
import { useLive2D } from "./useLive2D";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useChatStore } from "../stores/useChatStore";

type UseCharivoChatOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

export function useCharivoChat({ canvasContainerRef }: UseCharivoChatOptions) {
  const { getLive2DModelPath } = useCharacterStore();

  // Get all states and actions from store
  const {
    charivo,
    setCharivo,
    addMessage,
    clearMessages,
    input,
    setInput,
    setIsLoading,
    setIsSpeaking,
    isRecording,
    setIsRecording,
    setIsTranscribing,
    selectedLLMClient,
    selectedTTSPlayer,
    selectedSTTTranscriber,
    setLlmError,
    setTtsError,
    setSttError,
    isRealtimeMode,
  } = useChatStore();

  const initialLLMClientRef = useRef<LLMClientType>(selectedLLMClient);
  const initialTTSPlayerRef = useRef<TTSPlayerType>(selectedTTSPlayer);
  const initialSTTTranscriberRef = useRef<STTTranscriberType>(
    selectedSTTTranscriber,
  );
  const rendererRef = useRef<Live2DRendererHandle | null>(null);
  const sttManagerRef = useRef<ReturnType<typeof createSTTManager> | null>(
    null,
  );

  useEffect(() => {
    initialLLMClientRef.current = selectedLLMClient;
  }, [selectedLLMClient]);

  useEffect(() => {
    initialTTSPlayerRef.current = selectedTTSPlayer;
  }, [selectedTTSPlayer]);

  useEffect(() => {
    initialSTTTranscriberRef.current = selectedSTTTranscriber;
  }, [selectedSTTTranscriber]);

  const createLLMClient = useCallback(
    async (type: LLMClientType) => {
      setLlmError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteLLMClient } = await import(
              "@charivo/llm-client-remote"
            );
            return createRemoteLLMClient({ apiEndpoint: "/api/chat" });
          }
          case "openai": {
            const apiKey = prompt(
              "Enter your OpenAI API key for testing (not recommended for production):",
            );
            if (!apiKey) {
              throw new Error("API key is required for OpenAI LLM");
            }
            const { createOpenAILLMClient } = await import(
              "@charivo/llm-client-openai"
            );
            return createOpenAILLMClient({ apiKey });
          }
          case "stub":
          default: {
            const { createStubLLMClient } = await import(
              "@charivo/llm-client-stub"
            );
            return createStubLLMClient();
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setLlmError(`Failed to load ${type} LLM client: ${errorMessage}`);
        console.error("LLM Client Error:", error);
        throw error;
      }
    },
    [setLlmError],
  );

  const createTTSPlayer = useCallback(
    async (type: TTSPlayerType) => {
      setTtsError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteTTSPlayer } = await import(
              "@charivo/tts-player-remote"
            );
            return createRemoteTTSPlayer();
          }
          case "web": {
            const { createWebTTSPlayer } = await import(
              "@charivo/tts-player-web"
            );
            return createWebTTSPlayer();
          }
          case "openai": {
            const apiKey = prompt(
              "Enter your OpenAI API key for testing (not recommended for production):",
            );
            if (!apiKey) {
              throw new Error("API key is required for OpenAI TTS");
            }
            const { createOpenAITTSPlayer } = await import(
              "@charivo/tts-player-openai"
            );
            return createOpenAITTSPlayer({ apiKey });
          }
          case "none":
          default:
            return null;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setTtsError(`Failed to load ${type} TTS player: ${errorMessage}`);
        console.error("TTS Player Error:", error);
        return null;
      }
    },
    [setTtsError],
  );

  const createSTTTranscriber = useCallback(
    async (type: STTTranscriberType) => {
      setSttError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteSTTTranscriber } = await import(
              "@charivo/stt-transcriber-remote"
            );
            return createRemoteSTTTranscriber();
          }
          case "web": {
            const { createWebSTTTranscriber } = await import(
              "@charivo/stt-transcriber-web"
            );
            return createWebSTTTranscriber();
          }
          case "openai": {
            const apiKey = prompt(
              "Enter your OpenAI API key for testing (not recommended for production):",
            );
            if (!apiKey) {
              throw new Error("API key is required for OpenAI STT");
            }
            const { createOpenAISTTTranscriber } = await import(
              "@charivo/stt-transcriber-openai"
            );
            return createOpenAISTTTranscriber({ apiKey });
          }
          case "none":
          default:
            return null;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setSttError(`Failed to load ${type} STT transcriber: ${errorMessage}`);
        console.error("STT Transcriber Error:", error);
        return null;
      }
    },
    [setSttError],
  );

  const handleRendererReady = useCallback(
    async (
      renderer: Live2DRendererHandle,
      character: Character,
      canvas: HTMLCanvasElement,
    ) => {
      rendererRef.current = renderer;
      const instance = new Charivo();

      // Wrap with RenderManager (stateful)
      const { createRenderManager } = await import("@charivo/render-core");
      const renderManager = createRenderManager(renderer, {
        canvas,
        mouseTracking: "document",
      });

      await renderManager.initialize();
      await renderManager.loadModel?.(getLive2DModelPath(character.id));

      renderManager.setMessageCallback(
        (message: Message, character?: Character) => {
          addMessage({ ...message, character });
        },
      );

      const llmClient = await createLLMClient(initialLLMClientRef.current);
      const { createLLMManager } = await import("@charivo/llm-core");
      const llmManager = createLLMManager(llmClient);

      instance.attachRenderer(renderManager);
      instance.attachLLM(llmManager);

      const ttsPlayer = await createTTSPlayer(initialTTSPlayerRef.current);
      if (ttsPlayer) {
        const ttsManager = createTTSManager(ttsPlayer);
        instance.attachTTS(ttsManager);
      }

      instance.setCharacter(character);

      instance.on(
        "character:speak",
        ({ character: speakingCharacter, message }) => {
          console.log(`🎵 ${speakingCharacter.name}: "${message}"`);
        },
      );

      instance.on("tts:start", ({ text, characterId }) => {
        console.log(`🔊 TTS started for ${characterId}: "${text}"`);
        setIsSpeaking(true);
      });

      instance.on("tts:end", ({ characterId }) => {
        console.log(`🔇 TTS ended for ${characterId}`);
        setIsSpeaking(false);
      });

      instance.on("tts:error", ({ error }) => {
        console.error("❌ TTS Error:", error);
        setIsSpeaking(false);
      });

      // Initialize STT Manager
      const initializeSTT = async () => {
        try {
          const transcriber = await createSTTTranscriber(
            initialSTTTranscriberRef.current,
          );
          if (transcriber) {
            const sttManager = createSTTManager(transcriber);
            instance.attachSTT(sttManager);
            sttManagerRef.current = sttManager;
          }
        } catch (error) {
          console.error("Failed to initialize STT:", error);
          setSttError("STT initialization failed");
        }
      };

      instance.on("stt:start", ({ options }) => {
        console.log("🎤 STT recording started", options);
        setIsRecording(true);
      });

      instance.on("stt:stop", ({ transcription }) => {
        console.log("✅ STT transcription:", transcription);
        setIsRecording(false);
        setIsTranscribing(false);
        setInput(transcription);
      });

      instance.on("stt:error", ({ error }) => {
        console.error("❌ STT Error:", error);
        setIsRecording(false);
        setIsTranscribing(false);
        setSttError(error.message);
      });

      initializeSTT().catch(console.error);

      clearMessages();
      setCharivo(instance);

      return () => {
        setCharivo(null);
        clearMessages();
        setIsSpeaking(false);
      };
    },
    [
      createLLMClient,
      createTTSPlayer,
      createSTTTranscriber,
      getLive2DModelPath,
      addMessage,
      clearMessages,
      setCharivo,
      setIsSpeaking,
      setIsRecording,
      setIsTranscribing,
      setInput,
      setSttError,
    ],
  );

  useLive2D({ canvasContainerRef, onRendererReady: handleRendererReady });

  useEffect(() => {
    if (!charivo) return;

    const updateTTSPlayer = async () => {
      const player = await createTTSPlayer(selectedTTSPlayer);
      if (player) {
        const ttsManager = createTTSManager(player);
        charivo.attachTTS(ttsManager);
      } else {
        charivo.detachTTS();
      }
    };

    updateTTSPlayer().catch((error: unknown) => {
      console.error("Failed to update TTS player:", error);
    });
  }, [charivo, selectedTTSPlayer, createTTSPlayer]);

  useEffect(() => {
    if (!charivo) return;

    const updateLLMClient = async () => {
      try {
        const llmClient = await createLLMClient(selectedLLMClient);
        const { createLLMManager } = await import("@charivo/llm-core");
        const llmManager = createLLMManager(llmClient);
        charivo.clearHistory();
        charivo.attachLLM(llmManager);
      } catch (error) {
        console.error("Failed to update LLM client:", error);
      }
    };

    updateLLMClient().catch((error: unknown) => {
      console.error("Failed to update LLM client:", error);
    });
  }, [charivo, selectedLLMClient, createLLMClient]);

  useEffect(() => {
    if (!charivo) return;

    const updateSTTTranscriber = async () => {
      try {
        const transcriber = await createSTTTranscriber(selectedSTTTranscriber);
        if (transcriber) {
          const sttManager = createSTTManager(transcriber);
          charivo.attachSTT(sttManager);
          sttManagerRef.current = sttManager;
        } else {
          charivo.detachSTT();
          sttManagerRef.current = null;
        }
      } catch (error) {
        console.error("Failed to update STT transcriber:", error);
      }
    };

    updateSTTTranscriber().catch((error: unknown) => {
      console.error("Failed to update STT transcriber:", error);
    });
  }, [charivo, selectedSTTTranscriber, createSTTTranscriber]);

  const handleSend = useCallback(async () => {
    if (!charivo || !input.trim()) return;

    const userMessage = input;
    setInput("");
    setIsLoading(true);

    try {
      await charivo.userSay(userMessage);
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  }, [charivo, input, setInput, setIsLoading]);

  const handleKeyPress = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (isRealtimeMode && charivo) {
          const realtimeManager = charivo.getRealtimeManager();
          if (realtimeManager && input.trim()) {
            void realtimeManager.sendMessage(input);
            setInput("");
          }
        } else {
          void handleSend();
        }
      }
    },
    [handleSend, isRealtimeMode, charivo, input, setInput],
  );

  const playExpression = useCallback((expressionId: string) => {
    if (rendererRef.current) {
      rendererRef.current.playExpression(expressionId);
    }
  }, []);

  const playMotion = useCallback((group: string, index: number) => {
    if (rendererRef.current) {
      rendererRef.current.playMotionByGroup(group, index);
    }
  }, []);

  const getAvailableExpressions = useCallback((): string[] => {
    if (!rendererRef.current) return [];
    return rendererRef.current.getAvailableExpressions();
  }, []);

  const getAvailableMotionGroups = useCallback((): Record<string, number> => {
    if (!rendererRef.current) return {};
    return rendererRef.current.getAvailableMotionGroups();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!sttManagerRef.current) {
      setSttError("STT is not initialized. Please provide an OpenAI API key.");
      return;
    }

    try {
      setSttError(null);
      await sttManagerRef.current.start();
    } catch (error) {
      console.error("Failed to start recording:", error);
      setSttError(error instanceof Error ? error.message : "Recording failed");
      setIsRecording(false);
    }
  }, [setSttError, setIsRecording]);

  const handleStopRecording = useCallback(async () => {
    if (!sttManagerRef.current || !isRecording) return;

    try {
      setIsTranscribing(true);
      await sttManagerRef.current.stop();
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setSttError(
        error instanceof Error ? error.message : "Transcription failed",
      );
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [isRecording, setIsTranscribing, setSttError, setIsRecording]);

  return {
    handleSend,
    handleKeyPress,
    handleStartRecording,
    handleStopRecording,
    playExpression,
    playMotion,
    getAvailableExpressions,
    getAvailableMotionGroups,
  };
}
