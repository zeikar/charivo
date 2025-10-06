"use client";

import { useRef } from "react";

import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { ChatSettings } from "./components/chat/ChatSettings";
import { MessageBubbles } from "./components/chat/MessageBubbles";
import { ControlPanel } from "./components/chat/ControlPanel";
import { ChatInput } from "./components/chat/ChatInput";
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
    playExpression,
    playMotion,
    getAvailableExpressions,
    getAvailableMotionGroups,
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
    <div className="h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-6">
        <div className="container mx-auto max-w-7xl">
          <PageHeader />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-0 px-4 pb-6 gap-4">
        <div className="container mx-auto max-w-7xl flex-1 flex flex-col gap-4 min-h-0">
          {/* Character Area */}
          <div className="flex-1 min-h-0 relative">
            <Live2DPanel canvasContainerRef={canvasContainerRef} />

            <ChatSettings
              selectedLLMClient={selectedLLMClient}
              onSelectLLMClient={handleLLMClientChange}
              selectedTTSPlayer={selectedTTSPlayer}
              onSelectTTSPlayer={handleTTSPlayerChange}
              llmError={llmError}
              ttsError={ttsError}
            />

            <MessageBubbles
              messages={messages}
              isLoading={isLoading && !isSpeaking}
            />

            <ControlPanel
              onPlayExpression={playExpression}
              onPlayMotion={playMotion}
              getAvailableExpressions={getAvailableExpressions}
              getAvailableMotionGroups={getAvailableMotionGroups}
            />
          </div>

          {/* Chat Input Area */}
          <ChatInput
            value={input}
            onChange={handleInputChange}
            onSend={handleSendClick}
            onKeyPress={handleKeyPress}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
