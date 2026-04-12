"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import {
  Charivo,
  type Character,
  type LLMClient,
  type Message,
  type RenderManager,
  type STTManager,
  type STTTranscriber,
  type TTSManager,
  type TTSPlayer,
} from "@charivo/core";
import { createSTTManager } from "@charivo/stt-core";
import { createTTSManager } from "@charivo/tts-core";

import type {
  LLMClientType,
  STTTranscriberType,
  TTSPlayerType,
} from "../types/chat";
import { useLive2D } from "./useLive2D";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useChatStore } from "../stores/useChatStore";
import {
  createRealtimeAssistantMessage,
  getRealtimeTurnStatus,
  shouldResetRealtimeUiState,
} from "./realtime-ui";

type Live2DRendererHandle = {
  playExpression(expressionId: string): void;
  playMotionByGroup(group: string, index: number): void;
  getAvailableExpressions(): string[];
  getAvailableMotionGroups(): Record<string, number>;
};

type UseCharivoChatOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

const OPENAI_TESTING_PROMPT =
  "Enter your OpenAI API key. This direct browser client is for development/testing only.";
const OPENCLAW_TESTING_PROMPT =
  "Enter your OpenClaw token. This direct browser client is for development/testing only and may be blocked by CORS.";
const REALTIME_UI_DEBUG = process.env.NODE_ENV !== "production";

function logRealtimeUi(...args: unknown[]): void {
  if (REALTIME_UI_DEBUG) {
    console.debug("[realtime-ui]", ...args);
  }
}

function promptForSecret(message: string, missingMessage: string): string {
  const value = window.prompt(message)?.trim();
  if (!value) {
    throw new Error(missingMessage);
  }
  return value;
}

async function stopRealtime(instance: Charivo | null): Promise<void> {
  const realtimeManager = instance?.getRealtimeManager();
  if (!realtimeManager) {
    return;
  }

  try {
    await realtimeManager.stopSession();
  } catch {
    // Ignore teardown errors during effect cleanup.
  }
}

export function useCharivoChat({ canvasContainerRef }: UseCharivoChatOptions) {
  const { getLive2DModelPath } = useCharacterStore();
  const { canvas, character } = useLive2D({ canvasContainerRef });

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
    setIsRealtimeMode,
    setIsConnecting,
    setIsConnected,
    setRealtimeError,
    setRealtimeState,
    appendRealtimeAssistantDraft,
    resetRealtimeUiState,
    setRealtimeAssistantDraft,
    setRealtimeTurnStatus,
  } = useChatStore();

  const rendererRef = useRef<Live2DRendererHandle | null>(null);
  const sttManagerRef = useRef<STTManager | null>(null);

  const createLLMClient = useCallback(
    async (type: LLMClientType): Promise<LLMClient> => {
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
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI LLM client.",
            );
            const { createOpenAILLMClient } = await import(
              "@charivo/llm-client-openai"
            );
            return createOpenAILLMClient({ apiKey });
          }
          case "openclaw-remote": {
            const { createRemoteLLMClient } = await import(
              "@charivo/llm-client-remote"
            );
            return createRemoteLLMClient({ apiEndpoint: "/api/chat-openclaw" });
          }
          case "openclaw": {
            const token = promptForSecret(
              OPENCLAW_TESTING_PROMPT,
              "Token is required for the direct OpenClaw client.",
            );
            const { createOpenClawLLMClient } = await import(
              "@charivo/llm-client-openclaw"
            );
            return createOpenClawLLMClient({ token });
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
        const message =
          error instanceof Error ? error.message : "Unknown LLM client error";
        setLlmError(`Failed to load ${type} LLM client: ${message}`);
        throw error;
      }
    },
    [setLlmError],
  );

  const createTTSPlayer = useCallback(
    async (type: TTSPlayerType): Promise<TTSPlayer | null> => {
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
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI TTS client.",
            );
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
        const message =
          error instanceof Error ? error.message : "Unknown TTS client error";
        setTtsError(`Failed to load ${type} TTS player: ${message}`);
        throw error;
      }
    },
    [setTtsError],
  );

  const createSTTTranscriber = useCallback(
    async (type: STTTranscriberType): Promise<STTTranscriber | null> => {
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
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI STT client.",
            );
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
        const message =
          error instanceof Error ? error.message : "Unknown STT client error";
        setSttError(`Failed to load ${type} STT transcriber: ${message}`);
        throw error;
      }
    },
    [setSttError],
  );

  useEffect(() => {
    if (!canvas) {
      return;
    }

    let disposed = false;
    let instance: Charivo | null = null;
    let renderManager: RenderManager | null = null;
    let ttsManager: TTSManager | null = null;
    let sttManager: STTManager | null = null;

    const teardown = async () => {
      setCharivo(null);
      sttManagerRef.current = null;
      rendererRef.current = null;
      setIsLoading(false);
      setIsSpeaking(false);
      setIsRecording(false);
      setIsTranscribing(false);
      setIsConnecting(false);
      setIsConnected(false);
      setIsRealtimeMode(false);
      setRealtimeState(null);
      resetRealtimeUiState();

      if (ttsManager) {
        try {
          await ttsManager.stop();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }

      if (sttManager?.isRecording()) {
        try {
          await sttManager.stop();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }

      await stopRealtime(instance);
      instance?.detachRealtime();
      instance?.detachSTT();
      instance?.detachTTS();

      if (renderManager) {
        try {
          await renderManager.destroy();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }
    };

    const initialize = async () => {
      try {
        const [
          { Live2DRenderer },
          { createRenderManager },
          { createLLMManager },
        ] = await Promise.all([
          import("@charivo/render-live2d"),
          import("@charivo/render-core"),
          import("@charivo/llm-core"),
        ]);

        const renderer = new Live2DRenderer({ canvas });
        rendererRef.current = renderer;

        renderManager = createRenderManager(renderer, {
          canvas,
          mouseTracking: "document",
        });

        await renderManager.initialize();
        await renderManager.loadModel?.(getLive2DModelPath(character.id));

        if (disposed) {
          await teardown();
          return;
        }

        renderManager.setMessageCallback?.(
          (message: Message, owner?: Character) => {
            if (disposed) {
              return;
            }
            addMessage({ ...message, character: owner });
          },
        );

        const llmClient = await createLLMClient(selectedLLMClient);
        if (disposed) {
          await teardown();
          return;
        }

        const llmManager = createLLMManager(llmClient);
        instance = new Charivo();
        instance.attachRenderer(renderManager);
        instance.attachLLM(llmManager);

        const nextTtsPlayer = await createTTSPlayer(selectedTTSPlayer);
        if (nextTtsPlayer) {
          ttsManager = createTTSManager(nextTtsPlayer);
          instance.attachTTS(ttsManager);
        }

        const nextSttTranscriber = await createSTTTranscriber(
          selectedSTTTranscriber,
        );
        if (nextSttTranscriber) {
          sttManager = createSTTManager(nextSttTranscriber);
          instance.attachSTT(sttManager);
          sttManagerRef.current = sttManager;
        }

        instance.setCharacter(character);

        instance.on("tts:start", () => {
          if (!disposed) {
            setIsSpeaking(true);
          }
        });

        instance.on("tts:end", () => {
          if (!disposed) {
            setIsSpeaking(false);
          }
        });

        instance.on("tts:error", () => {
          if (!disposed) {
            setIsSpeaking(false);
          }
        });

        instance.on("stt:start", () => {
          if (!disposed) {
            setIsRecording(true);
          }
        });

        instance.on("stt:stop", ({ transcription }) => {
          if (disposed) {
            return;
          }
          setIsRecording(false);
          setIsTranscribing(false);
          setInput(transcription);
        });

        instance.on("stt:error", ({ error }) => {
          if (disposed) {
            return;
          }
          setIsRecording(false);
          setIsTranscribing(false);
          setSttError(error.message);
        });

        instance.on("realtime:state", ({ state }) => {
          if (disposed) {
            return;
          }

          logRealtimeUi("state", state);
          setRealtimeState(state);
          setIsConnecting(state.connection === "connecting");
          setIsConnected(state.connection === "connected");
          setRealtimeTurnStatus(getRealtimeTurnStatus(state));

          if (shouldResetRealtimeUiState(state)) {
            resetRealtimeUiState();
          }
        });

        instance.on("realtime:session:end", () => {
          if (disposed) {
            return;
          }

          resetRealtimeUiState();
        });

        instance.on("realtime:assistant:start", () => {
          if (disposed) {
            return;
          }

          logRealtimeUi("assistant.start");
          setRealtimeAssistantDraft(null);
        });

        instance.on("realtime:assistant:delta", ({ text }) => {
          if (disposed) {
            return;
          }

          logRealtimeUi("assistant.delta", text);
          appendRealtimeAssistantDraft(text);
        });

        instance.on("realtime:assistant:done", ({ text }) => {
          if (disposed) {
            return;
          }

          // Read the latest draft from the store because this handler may run
          // after multiple delta events and a captured value would go stale.
          const draft = useChatStore.getState().realtimeAssistantDraft;
          const finalText = draft || text;

          if (finalText.trim()) {
            logRealtimeUi("assistant.done", finalText);
            addMessage(createRealtimeAssistantMessage(finalText, character));
          }

          setRealtimeAssistantDraft(null);
        });

        instance.on("realtime:error", ({ error }) => {
          if (disposed) {
            return;
          }

          setRealtimeError(error.message);

          // Read the latest realtime state at event time rather than relying on
          // a captured closure value from the effect setup.
          const latestState = useChatStore.getState().realtimeState;
          if (shouldResetRealtimeUiState(latestState)) {
            resetRealtimeUiState();
          }
        });

        clearMessages();
        setRealtimeError(null);
        setRealtimeState(null);
        resetRealtimeUiState();
        setCharivo(instance);
      } catch (error) {
        if (!disposed) {
          console.error("Failed to initialize chat session:", error);
        }
        await teardown();
      }
    };

    void initialize();

    return () => {
      disposed = true;
      clearMessages();
      void teardown();
    };
  }, [
    addMessage,
    canvas,
    character,
    clearMessages,
    createLLMClient,
    createSTTTranscriber,
    createTTSPlayer,
    getLive2DModelPath,
    selectedLLMClient,
    selectedSTTTranscriber,
    selectedTTSPlayer,
    setCharivo,
    setInput,
    setIsConnected,
    setIsConnecting,
    setIsLoading,
    setIsRecording,
    setIsRealtimeMode,
    setIsSpeaking,
    setIsTranscribing,
    setLlmError,
    setRealtimeError,
    setRealtimeState,
    appendRealtimeAssistantDraft,
    resetRealtimeUiState,
    setRealtimeAssistantDraft,
    setRealtimeTurnStatus,
    setSttError,
  ]);

  const handleSend = useCallback(async () => {
    if (!charivo || !input.trim()) {
      return;
    }

    const userMessage = input;
    setInput("");
    setIsLoading(true);

    try {
      await charivo.userSay(userMessage);
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : "Failed to send message",
      );
    } finally {
      setIsLoading(false);
    }
  }, [charivo, input, setInput, setIsLoading, setLlmError]);

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
    [charivo, handleSend, input, isRealtimeMode, setInput],
  );

  const playExpression = useCallback((expressionId: string) => {
    rendererRef.current?.playExpression(expressionId);
  }, []);

  const playMotion = useCallback((group: string, index: number) => {
    rendererRef.current?.playMotionByGroup(group, index);
  }, []);

  const getAvailableExpressions = useCallback((): string[] => {
    return rendererRef.current?.getAvailableExpressions() ?? [];
  }, []);

  const getAvailableMotionGroups = useCallback((): Record<string, number> => {
    return rendererRef.current?.getAvailableMotionGroups() ?? {};
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (!sttManagerRef.current) {
      setSttError(
        "STT is not initialized. Use the remote/browser path or provide a direct-testing API key.",
      );
      return;
    }

    try {
      setSttError(null);
      await sttManagerRef.current.start();
    } catch (error) {
      setSttError(error instanceof Error ? error.message : "Recording failed");
      setIsRecording(false);
    }
  }, [setIsRecording, setSttError]);

  const handleStopRecording = useCallback(async () => {
    if (!sttManagerRef.current || !isRecording) {
      return;
    }

    try {
      setIsTranscribing(true);
      await sttManagerRef.current.stop();
    } catch (error) {
      setSttError(
        error instanceof Error ? error.message : "Transcription failed",
      );
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [isRecording, setIsRecording, setIsTranscribing, setSttError]);

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
