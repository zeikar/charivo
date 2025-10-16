"use client";

import { useRef, useEffect } from "react";

import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { ChatSettings } from "./components/chat/ChatSettings";
import { MessageBubbles } from "./components/chat/MessageBubbles";
import { ControlPanel } from "./components/chat/ControlPanel";
import { ChatInput } from "./components/chat/ChatInput";
import { useCharivoChat } from "./hooks/useCharivoChat";
import type {
  LLMClientType,
  TTSPlayerType,
  STTTranscriberType,
} from "./types/chat";

export default function Home() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    input,
    setInput,
    isLoading,
    isSpeaking,
    isRecording,
    isTranscribing,
    selectedLLMClient,
    setSelectedLLMClient,
    selectedTTSPlayer,
    setSelectedTTSPlayer,
    selectedSTTTranscriber,
    setSelectedSTTTranscriber,
    llmError,
    ttsError,
    sttError,
    handleSend,
    handleKeyPress,
    handleStartRecording,
    handleStopRecording,
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

  const handleSTTTranscriberChange = (type: STTTranscriberType) => {
    setSelectedSTTTranscriber(type);
  };

  // Log STT errors
  useEffect(() => {
    if (sttError) {
      console.error("STT Error:", sttError);
    }
  }, [sttError]);

  return (
    <div className="h-screen bg-white dark:bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-4">
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
              selectedSTTTranscriber={selectedSTTTranscriber}
              onSelectSTTTranscriber={handleSTTTranscriberChange}
              llmError={llmError}
              ttsError={ttsError}
              sttError={sttError}
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
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            sttDisabled={selectedSTTTranscriber === "none"}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        </div>
      </div>
    </div>
  );
}
