"use client";

import { useState, useEffect, type KeyboardEvent } from "react";
import { Charivo, type Message, type Character } from "@charivo/core";
import { createRemoteLLMClient } from "@charivo/llm-client-remote";

// 메시지 렌더링에 사용할 확장 타입
type ChatMessage = Message & { character?: Character };

// TTS 플레이어 타입 정의
type TTSPlayerType = "remote" | "web" | "openai" | "none";

export default function Home() {
  const [charivo, setCharivo] = useState<Charivo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTTSPlayer, setSelectedTTSPlayer] =
    useState<TTSPlayerType>("remote");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // TTS 플레이어 생성 함수
  const createTTSPlayer = async (type: TTSPlayerType) => {
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
          // 브라우저에서 OpenAI 직접 호출 (테스트용)
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
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setTtsError(`Failed to load ${type} TTS player: ${errorMsg}`);
      console.error("TTS Player Error:", error);
      return null;
    }
  };

  useEffect(() => {
    const initCharivo = async () => {
      console.log("🚀 Starting Charivo initialization...");

      const instance = new Charivo();

      // Canvas 요소 생성 - 캐릭터 영역에 맞게 더 크게
      const canvas = document.createElement("canvas");
      canvas.width = 300;
      canvas.height = 300;
      canvas.style.border = "2px solid #ccc";
      canvas.style.borderRadius = "8px";

      const { Live2DRenderer } = await import("@charivo/render-live2d");
      const live2dRenderer = new Live2DRenderer(canvas);
      const llmAdapter = createRemoteLLMClient({ apiEndpoint: "/api/chat" });

      console.log("📦 Created instances:", {
        instance,
        live2dRenderer,
        llmAdapter,
      });

      // 메시지 콜백 설정
      live2dRenderer.setMessageCallback(
        (message: Message, character?: Character) => {
          console.log("📨 Message callback triggered:", message, character);
          setMessages((prev) => [...prev, { ...message, character }]);
        },
      );

      await live2dRenderer.initialize();

      // Live2D 모델 로드 (Hiyori 모델)
      await live2dRenderer.loadModel(
        "/live2d/hiyori_free_en/runtime/hiyori_free_t08.model3.json",
      );

      instance.attachRenderer(live2dRenderer);
      instance.attachLLM(llmAdapter);

      // 초기 TTS 플레이어 설정
      const ttsPlayer = await createTTSPlayer(selectedTTSPlayer);
      if (ttsPlayer) {
        instance.attachTTS(ttsPlayer);
      }

      // Add character (Hiyori)
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
      live2dRenderer.setCharacter(character);

      // Event listeners
      instance.on("character:speak", ({ character, message }) => {
        console.log(`🎵 ${character.name}: "${message}"`);
      });

      // TTS event listeners
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

      // Canvas를 DOM에 추가
      const canvasContainer = document.getElementById("live2d-canvas");
      if (canvasContainer) {
        canvasContainer.appendChild(canvas);
      }

      console.log("✅ Charivo initialization complete");
      setCharivo(instance);
    };

    initCharivo().catch(console.error);
  }, []);

  // TTS 플레이어 변경 시 재초기화
  useEffect(() => {
    const updateTTSPlayer = async () => {
      if (!charivo) return;

      const ttsPlayer = await createTTSPlayer(selectedTTSPlayer);
      if (ttsPlayer) {
        charivo.attachTTS(ttsPlayer);
      }
    };

    updateTTSPlayer();
  }, [selectedTTSPlayer, charivo]);

  const handleSend = async () => {
    if (!charivo || !input.trim()) return;

    setIsLoading(true);
    try {
      await charivo.userSay(input, "hiyori");
      setInput("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      <div className="container mx-auto px-4 py-6 flex-1 flex flex-col max-w-6xl">
        {/* Header - 컴팩트하게 조정 */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
            🧩✨ Charivo Live2D Demo
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-base mb-1">
            Interactive AI Character Framework
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-xs max-w-3xl mx-auto mb-3">
            Experience the power of Charivo - a modular Live2D + LLM framework.
            Chat with Hiyori and explore real-time 2D animations, AI
            conversations powered by OpenAI GPT, and natural voice synthesis
            using OpenAI TTS API.
          </p>
          <div className="flex justify-center items-center space-x-3 text-xs text-gray-400">
            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
              TypeScript
            </span>
            <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
              Live2D
            </span>
            <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
              OpenAI
            </span>
            <span className="bg-pink-100 text-pink-800 px-2 py-1 rounded">
              OpenAI TTS
            </span>
          </div>
        </div>

        {/* Main Layout: Character (Left) + Chat (Right) - 화면 높이에 맞게 조정 */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 flex-1 min-h-0">
          {/* Left Side - Live2D Character (더 넓게) */}
          <div className="lg:col-span-3 flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg h-full flex flex-col">
              <div className="text-center mb-3">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">
                  🎮 Live2D Character
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  Powered by Charivo Framework
                </p>
              </div>

              <div className="flex justify-center items-center flex-1">
                <div
                  id="live2d-canvas"
                  className="flex justify-center items-center bg-gradient-to-b from-blue-50 to-blue-100 dark:from-gray-700 dark:to-gray-800 rounded-lg"
                  style={{ width: 450, height: 600 }}
                >
                  {/* Canvas will be dynamically added here */}
                </div>
              </div>

              {/* Speaking Status만 유지 */}
              {isSpeaking && (
                <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                  <div className="flex items-center justify-center space-x-2 text-sm text-blue-600 dark:text-blue-400">
                    <div className="animate-pulse">🎵</div>
                    <span>Speaking...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Side - Chat Interface (좀 더 좁게) */}
          <div className="lg:col-span-2 flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden h-full flex flex-col">
              {/* Chat Header - TTS 선택 옵션 포함 */}
              <div className="bg-blue-500 dark:bg-blue-600 p-4">
                <h2 className="text-lg font-semibold text-white mb-1">
                  💬 AI Chat Interface
                </h2>
                <p className="text-blue-100 text-xs mb-3">
                  Modular LLM integration with OpenAI GPT
                </p>

                {/* TTS 플레이어 선택 */}
                <div className="space-y-3">
                  <div className="text-sm font-medium text-white">
                    🔊 TTS Player Options:
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer">
                      <input
                        type="radio"
                        name="ttsPlayer"
                        value="remote"
                        checked={selectedTTSPlayer === "remote"}
                        onChange={(e) =>
                          setSelectedTTSPlayer(e.target.value as TTSPlayerType)
                        }
                        className="text-blue-500"
                      />
                      <span>Remote API</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer">
                      <input
                        type="radio"
                        name="ttsPlayer"
                        value="web"
                        checked={selectedTTSPlayer === "web"}
                        onChange={(e) =>
                          setSelectedTTSPlayer(e.target.value as TTSPlayerType)
                        }
                        className="text-blue-500"
                      />
                      <span>Browser TTS</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer">
                      <input
                        type="radio"
                        name="ttsPlayer"
                        value="openai"
                        checked={selectedTTSPlayer === "openai"}
                        onChange={(e) =>
                          setSelectedTTSPlayer(e.target.value as TTSPlayerType)
                        }
                        className="text-blue-500"
                      />
                      <span>OpenAI Direct</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer">
                      <input
                        type="radio"
                        name="ttsPlayer"
                        value="none"
                        checked={selectedTTSPlayer === "none"}
                        onChange={(e) =>
                          setSelectedTTSPlayer(e.target.value as TTSPlayerType)
                        }
                        className="text-blue-500"
                      />
                      <span>Disabled</span>
                    </label>
                  </div>

                  {/* 선택된 플레이어 설명 */}
                  <div className="text-xs text-blue-200 bg-blue-600/50 p-2 rounded">
                    {selectedTTSPlayer === "remote" &&
                      "🌐 Calls server TTS API (secure)"}
                    {selectedTTSPlayer === "web" &&
                      "🔊 Uses browser's built-in TTS"}
                    {selectedTTSPlayer === "openai" &&
                      "⚡ Direct OpenAI API (test only)"}
                    {selectedTTSPlayer === "none" && "🔇 No voice synthesis"}
                  </div>

                  {/* TTS 에러 표시 */}
                  {ttsError && (
                    <div className="text-xs text-red-200 bg-red-600/50 p-2 rounded">
                      ⚠️ {ttsError}
                    </div>
                  )}
                </div>
              </div>

              {/* Chat Messages - flex-1로 남은 공간 모두 사용 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 dark:text-gray-400 flex flex-col justify-center h-full">
                    <div className="text-3xl mb-3">🚀</div>
                    <p className="text-base font-medium mb-2">
                      Ready to explore Charivo!
                    </p>
                    <p className="text-xs max-w-sm mx-auto">
                      Start a conversation with Hiyori to see Live2D animations,
                      AI responses, and voice synthesis in action
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.type === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className="max-w-[75%]">
                      {msg.type !== "user" && msg.character && (
                        <div className="flex items-center space-x-2 mb-1">
                          <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                            <span className="text-xs text-white font-bold">
                              H
                            </span>
                          </div>
                          <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                            {msg.character.name}
                          </span>
                        </div>
                      )}
                      <div
                        className={`px-4 py-3 rounded-lg ${
                          msg.type === "user"
                            ? "bg-blue-500 text-white rounded-br-none"
                            : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded-bl-none"
                        }`}
                      >
                        <div className="text-sm leading-relaxed">
                          {msg.content}
                        </div>
                        <div className="text-xs opacity-70 mt-1">
                          {msg.timestamp instanceof Date
                            ? msg.timestamp.toLocaleTimeString()
                            : new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="max-w-[75%]">
                      <div className="flex items-center space-x-2 mb-1">
                        <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                          <span className="text-xs text-white font-bold">
                            H
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                          Hiyori
                        </span>
                      </div>
                      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg rounded-bl-none px-4 py-3">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                          <div
                            className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                            style={{ animationDelay: "0.1s" }}
                          ></div>
                          <div
                            className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"
                            style={{ animationDelay: "0.2s" }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input - 고정 높이 */}
              <div className="border-t dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-700">
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Experience Charivo framework - type your message..."
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm"
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium text-sm"
                  >
                    {isLoading ? "..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
