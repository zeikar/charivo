"use client";

import { useRef } from "react";

import { FeatureShowcase } from "./components/FeatureShowcase";
import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { ChatPanel } from "./components/chat/ChatPanel";
import { useCharivoChat } from "./hooks/useCharivoChat";
import type { LLMClientType, TTSPlayerType } from "./types/chat";

export default function Home() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const {
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
  } = useCharivoChat({ canvasContainerRef });

  const handleSendClick = () => {
    void handleSend();
  };

  const handleInputChange = (value: string) => {
    setInput(value);
  };

  const handleLLMClientChange = (type: LLMClientType) => {
    setSelectedLLMClient(type);
  };

  const handleTTSPlayerChange = (type: TTSPlayerType) => {
    setSelectedTTSPlayer(type);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex flex-col">
      <div className="container mx-auto px-4 py-6 flex-1 flex flex-col max-w-7xl">
        <PageHeader />

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 flex-1 min-h-0 mb-6">
          <Live2DPanel
            canvasContainerRef={canvasContainerRef}
            isSpeaking={isSpeaking}
          />

          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            input={input}
            onInputChange={handleInputChange}
            onSend={handleSendClick}
            onKeyPress={handleKeyPress}
            selectedLLMClient={selectedLLMClient}
            onSelectLLMClient={handleLLMClientChange}
            selectedTTSPlayer={selectedTTSPlayer}
            onSelectTTSPlayer={handleTTSPlayerChange}
            llmError={llmError}
            ttsError={ttsError}
          />
        </div>

        {/* Interactive Features Showcase */}
        <FeatureShowcase />

        {/* Footer */}
        <footer className="text-center py-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-center items-center gap-4 mb-2">
            <a
              href="https://github.com/zeikar/charivo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              GitHub Repository
            </a>
            <span className="text-gray-400">•</span>
            <a
              href="https://github.com/zeikar/charivo#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
            >
              Documentation
            </a>
            <span className="text-gray-400">•</span>
            <a
              href="https://github.com/zeikar/charivo/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
            >
              Issues
            </a>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Built with ❤️ using{" "}
            <span className="font-semibold">Charivo Framework</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
