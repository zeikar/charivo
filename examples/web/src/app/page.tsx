"use client";

import { useState, useEffect, type KeyboardEvent } from "react";
import { Charivo, type Message, type Character } from "@charivo/core";
import { createOpenAIAdapter } from "@charivo/adapter-llm-openai";

// 메시지 렌더링에 사용할 확장 타입
type ChatMessage = Message & { character?: Character };

export default function Home() {
  const [charivo, setCharivo] = useState<Charivo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTTSEnabled, setIsTTSEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const initCharivo = async () => {
      console.log("🚀 Starting Charivo initialization...");

      const instance = new Charivo();

      // Canvas 요소 생성
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
      canvas.style.border = "2px solid #ccc";
      canvas.style.borderRadius = "8px";

      const { Live2DRenderer } = await import("@charivo/render-live2d");
      const live2dRenderer = new Live2DRenderer(canvas);
      const llmAdapter = createOpenAIAdapter("/api/chat");

      // TTS 어댑터 생성 (브라우저 환경에서만)
      let ttsAdapter;
      try {
        const { createWebTTSAdapter } = await import(
          "@charivo/adapter-tts-web"
        );
        ttsAdapter = createWebTTSAdapter();
      } catch (error) {
        console.warn("TTS not supported:", error);
        setIsTTSEnabled(false);
      }

      console.log("📦 Created instances:", {
        instance,
        live2dRenderer,
        llmAdapter,
        ttsAdapter,
      });

      // 메시지 콜백 설정
      live2dRenderer.setMessageCallback(
        (message: Message, character?: Character) => {
          console.log("📨 Message callback triggered:", message, character);
          setMessages((prev) => [...prev, { ...message, character }]);
        }
      );

      await live2dRenderer.initialize();

      // Live2D 모델 로드 (Hiyori 모델)
      await live2dRenderer.loadModel(
        "/live2d/hiyori_free_en/runtime/hiyori_free_t08.model3.json"
      );

      instance.attachRenderer(live2dRenderer);
      instance.attachLLM(llmAdapter);

      // TTS 어댑터 연결
      if (ttsAdapter) {
        instance.attachTTS(ttsAdapter);
      }

      // Add character (Hiyori)
      const character: Character = {
        id: "hiyori",
        name: "Hiyori",
        description: "A cute Live2D character who loves to chat and help users",
        personality: "Bright, cheerful, and helpful personality. Always responds in English and loves engaging conversations.",
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-2">
            🧩✨ Charivo Live2D Demo
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            Chat with Hiyori!
          </p>
        </div>

        {/* Main Layout: Character (Left) + Chat (Right) */}
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Side - Live2D Character */}
          <div className="flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg h-full">
              <div className="text-center mb-4">
                <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
                  🎮 Hiyori
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Your Live2D AI Character
                </p>
              </div>
              
              <div className="flex justify-center items-center flex-1 min-h-[500px]">
                <div
                  id="live2d-canvas"
                  className="flex justify-center items-center bg-gradient-to-b from-blue-50 to-blue-100 dark:from-gray-700 dark:to-gray-800 rounded-lg"
                  style={{ width: 400, height: 600 }}
                >
                  {/* Canvas will be dynamically added here */}
                </div>
              </div>

              {/* Character Status */}
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-gray-600 dark:text-gray-300">
                      Online
                    </span>
                  </div>
                  {isSpeaking && (
                    <div className="flex items-center space-x-1 text-blue-600 dark:text-blue-400">
                      <div className="animate-pulse">🎵</div>
                      <span>Speaking...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Chat Interface */}
          <div className="flex flex-col">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden h-full flex flex-col">
              {/* Chat Header */}
              <div className="bg-blue-500 dark:bg-blue-600 p-4">
                <h2 className="text-xl font-semibold text-white mb-2">
                  💬 Chat with Hiyori
                </h2>
                <div className="flex items-center space-x-2">
                  <label className="flex items-center space-x-1 text-sm text-blue-100">
                    <input
                      type="checkbox"
                      checked={isTTSEnabled}
                      onChange={(e) => setIsTTSEnabled(e.target.checked)}
                      className="rounded"
                    />
                    <span>🔊 Enable TTS</span>
                  </label>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[400px] max-h-[500px]">
                {messages.length === 0 && (
                  <div className="text-center text-gray-500 dark:text-gray-400 py-12">
                    <div className="text-4xl mb-4">👋</div>
                    <p className="text-lg font-medium mb-2">Start chatting!</p>
                    <p className="text-sm">
                      Say hello to Hiyori and begin your conversation
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
                            <span className="text-xs text-white font-bold">H</span>
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
                        <div className="text-sm leading-relaxed">{msg.content}</div>
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
                          <span className="text-xs text-white font-bold">H</span>
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

              {/* Chat Input */}
              <div className="border-t dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-700">
                <div className="flex space-x-3">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message to Hiyori..."
                    className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    disabled={isLoading}
                  />
                  <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                    className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 font-medium"
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
