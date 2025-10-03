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

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    canvas.style.border = "2px solid #ccc";
    canvas.style.borderRadius = "8px";

    let isMounted = true;
    let live2DRenderer: Live2DRendererHandle | null = null;
    const container = canvasContainerRef.current;

    const initCharivo = async () => {
      if (!container) return;

      container.innerHTML = "";
      container.appendChild(canvas);

      const instance = new Charivo();

      // Create Live2D renderer (stateless)
      const { Live2DRenderer } = await import("@charivo/render-live2d");
      const live2dRenderer = new Live2DRenderer({
        canvas,
        mouseTracking: "document",
      });
      live2DRenderer = live2dRenderer;

      await live2dRenderer.initialize();
      await live2dRenderer.loadModel(
        "/live2d/hiyori_free_en/runtime/hiyori_free_t08.model3.json",
      );

      // Wrap with RenderManager (stateful)
      const { createRenderManager } = await import("@charivo/render-core");
      const renderManager = createRenderManager(live2dRenderer);

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

      const character: Character = {
        id: "hiyori",
        name: "Hiyori",
        description: "A cute Live2D character who loves to chat and help users",
        personality:
          "Bright, cheerful, and helpful personality. Always responds in English and loves engaging conversations.",
        voice: {
          rate: 1.0,
          pitch: 1.2,
          volume: 0.8,
        },
      };

      instance.addCharacter(character);
      renderManager.setCharacter(character);

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

      if (!isMounted) return;

      setMessages([]);
      setCharivo(instance);
    };

    initCharivo().catch((error: unknown) => {
      console.error("Failed to initialize Charivo:", error);
    });

    return () => {
      isMounted = false;
      setCharivo(null);
      setMessages([]);
      setIsSpeaking(false);

      if (container && container.contains(canvas)) {
        container.removeChild(canvas);
      }

      if (live2DRenderer) {
        void live2DRenderer.destroy().catch((error: unknown) => {
          console.error("Failed to destroy Live2D renderer:", error);
        });
      }
    };
  }, [canvasContainerRef, createLLMClient, createTTSPlayer]);

  useEffect(() => {
    if (!charivo) return;

    const updateTTSPlayer = async () => {
      const player = await createTTSPlayer(selectedTTSPlayer);
      if (player) {
        const ttsManager = createTTSManager(player);
        charivo.attachTTS(ttsManager);
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
      await charivo.userSay(input, "hiyori");
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
