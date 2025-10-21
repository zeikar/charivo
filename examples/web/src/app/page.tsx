"use client";

import { useRef, useEffect } from "react";

import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { ChatSettings } from "./components/chat/ChatSettings";
import { MessageBubbles } from "./components/chat/MessageBubbles";
import { ControlPanel } from "./components/chat/ControlPanel";
import { ChatInput } from "./components/chat/ChatInput";
import { useCharivoChat } from "./hooks/useCharivoChat";
import { useRealtimeMode } from "./hooks/useRealtimeMode";
import { useChatStore } from "./stores/useChatStore";

export default function Home() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Get states and actions from store
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
    selectedSTTTranscriber,
    setSelectedSTTTranscriber,
    llmError,
    ttsError,
    sttError,
    isRealtimeMode,
    realtimeError,
  } = useChatStore();

  // Initialize hooks
  const {
    handleSend,
    handleKeyPress,
    handleStartRecording,
    handleStopRecording,
    playExpression,
    playMotion,
    getAvailableExpressions,
    getAvailableMotionGroups,
  } = useCharivoChat({ canvasContainerRef });

  const { toggleRealtimeMode, sendRealtimeMessage } = useRealtimeMode();

  const handleSendClick = () => {
    if (isRealtimeMode) {
      void sendRealtimeMessage(input);
      setInput("");
    } else {
      void handleSend();
    }
  };

  // Log errors
  useEffect(() => {
    if (sttError) {
      console.error("STT Error:", sttError);
    }
  }, [sttError]);

  useEffect(() => {
    if (realtimeError) {
      console.error("Realtime Error:", realtimeError);
    }
  }, [realtimeError]);

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
              onSelectLLMClient={setSelectedLLMClient}
              selectedTTSPlayer={selectedTTSPlayer}
              onSelectTTSPlayer={setSelectedTTSPlayer}
              selectedSTTTranscriber={selectedSTTTranscriber}
              onSelectSTTTranscriber={setSelectedSTTTranscriber}
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
            onSend={handleSendClick}
            onKeyPress={handleKeyPress}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onToggleRealtimeMode={toggleRealtimeMode}
          />
        </div>
      </div>
    </div>
  );
}
