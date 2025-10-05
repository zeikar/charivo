"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MutableRefObject,
  type KeyboardEvent,
} from "react";
import { Charivo, type Character, type Message } from "@charivo/core";
import { createTTSManager } from "@charivo/tts-core";
type Live2DRendererModule = typeof import("@charivo/render-live2d");
type Live2DRendererClass = Live2DRendererModule["Live2DRenderer"];
type Live2DRendererHandle = InstanceType<Live2DRendererClass>;

import type { ChatMessage, LLMClientType, TTSPlayerType } from "../types/chat";
import { useLive2D } from "./useLive2D";
import { useCharacterStore } from "../stores/useCharacterStore";

type UseCharivoChatOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

type UseCharivoChatReturn = {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isSpeaking: boolean;
  selectedLLMClient: LLMClientType;
  setSelectedLLMClient: (type: LLMClientType) => void;
  selectedTTSPlayer: TTSPlayerType;
  setSelectedTTSPlayer: (type: TTSPlayerType) => void;
  llmError: string | null;
  ttsError: string | null;
  handleSend: () => Promise<void>;
  handleKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export function useCharivoChat({
  canvasContainerRef,
}: UseCharivoChatOptions): UseCharivoChatReturn {
  const { getLive2DModelPath } = useCharacterStore();
  const [charivo, setCharivo] = useState<Charivo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTTSPlayer, setSelectedTTSPlayer] =
    useState<TTSPlayerType>("remote");
  const [selectedLLMClient, setSelectedLLMClient] =
    useState<LLMClientType>("remote");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  const initialLLMClientRef = useRef<LLMClientType>(selectedLLMClient);
  const initialTTSPlayerRef = useRef<TTSPlayerType>(selectedTTSPlayer);

  useEffect(() => {
    initialLLMClientRef.current = selectedLLMClient;
  }, [selectedLLMClient]);

  useEffect(() => {
    initialTTSPlayerRef.current = selectedTTSPlayer;
  }, [selectedTTSPlayer]);

  const createLLMClient = useCallback(async (type: LLMClientType) => {
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
  }, []);

  const createTTSPlayer = useCallback(async (type: TTSPlayerType) => {
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
  }, []);

  const handleRendererReady = useCallback(
    async (
      renderer: Live2DRendererHandle,
      character: Character,
      canvas: HTMLCanvasElement,
    ) => {
      const instance = new Charivo();

      // Wrap with RenderManager (stateful)
      const { createRenderManager } = await import("@charivo/render-core");
      const renderManager = createRenderManager(renderer, {
        canvas,
        mouseTracking: "document",
      });

      // Initialize RenderManager (this will also setup mouse tracking)
      await renderManager.initialize();
      await renderManager.loadModel?.(getLive2DModelPath(character.id));

      renderManager.setMessageCallback(
        (message: Message, character?: Character) => {
          setMessages((prev) => [...prev, { ...message, character }]);
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

      setMessages([]);
      setCharivo(instance);

      return () => {
        setCharivo(null);
        setMessages([]);
        setIsSpeaking(false);
      };
    },
    [createLLMClient, createTTSPlayer, getLive2DModelPath],
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
        // TTS player is null (disabled), detach TTS
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

  const handleSend = useCallback(async () => {
    if (!charivo || !input.trim()) return;

    setIsLoading(true);
    try {
      await charivo.userSay(input);
      setInput("");
    } finally {
      setIsLoading(false);
    }
  }, [charivo, input]);

  const handleKeyPress = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return {
    messages,
    input,
    setInput,
    isLoading,
    isSpeaking,
    selectedLLMClient,
    setSelectedLLMClient,
    selectedTTSPlayer,
    setSelectedTTSPlayer,
    llmError,
    ttsError,
    handleSend,
    handleKeyPress,
  };
}
