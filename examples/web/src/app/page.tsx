"use client";

import { useRef } from "react";

import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { BubbleChatPanel } from "./components/chat/BubbleChatPanel";
import { ChatSettings } from "./components/chat/ChatSettings";
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
    <div className="h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex flex-col overflow-hidden">
      <div className="container mx-auto px-4 py-6 flex flex-col max-w-7xl h-full overflow-hidden">
        <PageHeader />

        {/* Main Content - Character with Bubble Chat Overlay */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <Live2DPanel canvasContainerRef={canvasContainerRef} />

          {/* Settings Overlay */}
          <ChatSettings
            selectedLLMClient={selectedLLMClient}
            onSelectLLMClient={handleLLMClientChange}
            selectedTTSPlayer={selectedTTSPlayer}
            onSelectTTSPlayer={handleTTSPlayerChange}
            llmError={llmError}
            ttsError={ttsError}
          />

          {/* Bubble Chat Overlay */}
          <BubbleChatPanel
            messages={messages}
            isLoading={isLoading && !isSpeaking}
            input={input}
            onInputChange={handleInputChange}
            onSend={handleSendClick}
            onKeyPress={handleKeyPress}
          />
        </div>
      </div>
    </div>
  );
}
