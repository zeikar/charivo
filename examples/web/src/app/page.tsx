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

      // 캐릭터 추가 (Hiyori)
      const character: Character = {
        id: "hiyori",
        name: "Hiyori",
        description: "귀여운 Live2D 캐릭터",
        personality: "밝고 활발한 성격",
      };
      instance.addCharacter(character);
      live2dRenderer.setCharacter(character);

      // 이벤트 리스너
      instance.on("character:speak", ({ character, message }) => {
        console.log(`🎵 ${character.name}: "${message}"`);
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
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 dark:text-white mb-2">
              🎭 Charivo Live2D Demo
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              Hiyori와 대화해보세요!
            </p>
          </div>

          {/* Live2D 캐릭터 영역 */}
          <div className="flex justify-center mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
              <div className="text-center mb-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  🎮 Live2D Character
                </span>
              </div>
              <div
                id="live2d-canvas"
                className="flex justify-center"
                style={{ width: 360, height: 540 }}
              >
                {/* Canvas가 여기에 동적으로 추가됩니다 */}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div className="h-96 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                  대화를 시작해보세요! 👋
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.type === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      msg.type === "user"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white"
                    }`}
                  >
                    {msg.type !== "user" && msg.character && (
                      <div className="text-xs font-semibold mb-1 text-purple-600 dark:text-purple-400">
                        {msg.character.name}
                      </div>
                    )}
                    <div className="text-sm">{msg.content}</div>
                    <div className="text-xs opacity-70 mt-1">
                      {msg.timestamp instanceof Date
                        ? msg.timestamp.toLocaleTimeString()
                        : new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2">
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
              )}
            </div>

            <div className="border-t dark:border-gray-700 p-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="메시지를 입력하세요..."
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  disabled={isLoading}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
