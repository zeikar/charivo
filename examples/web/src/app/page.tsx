"use client";

import { useRef, useEffect, type KeyboardEvent } from "react";

import { Live2DPanel } from "./components/Live2DPanel";
import { PageHeader } from "./components/PageHeader";
import { ChatSettings } from "./components/chat/ChatSettings";
import { MessageBubbles } from "./components/chat/MessageBubbles";
import { ControlPanel } from "./components/chat/ControlPanel";
import { AvatarDebugPanel } from "./components/chat/AvatarDebugPanel";
import { ChatInput } from "./components/chat/ChatInput";
import { SessionCapNotice } from "./components/chat/SessionCapNotice";
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
    isRealtimeMode,
    selectedLLMClient,
    setSelectedLLMClient,
    selectedTTSPlayer,
    setSelectedTTSPlayer,
    selectedSTTTranscriber,
    setSelectedSTTTranscriber,
    llmError,
    ttsError,
    sttError,
    realtimeError,
    realtimeAssistantDraft,
    realtimeInterruptedDraft,
  } = useChatStore();

  // Initialize hooks
  const {
    handleSend,
    handleStartRecording,
    handleStopRecording,
    playExpression,
    playMotion,
    playGaze,
    getAvailableExpressions,
    getAvailableMotionGroups,
  } = useCharivoChat({ canvasContainerRef });

  const { toggleRealtimeMode, sendRealtimeMessage, interruptRealtime } =
    useRealtimeMode();

  const handleSendClick = () => {
    if (!input.trim()) {
      return;
    }

    if (isRealtimeMode) {
      // Clear only once it is actually sent. A rejected send (a response still
      // in progress, a dropped session) used to swallow the text silently.
      void sendRealtimeMessage(input).then((sent) => {
        if (sent) {
          setInput("");
        }
      });
    } else {
      void handleSend();
    }
  };

  // Enter and the Send button must stay one behavior. They were separate
  // implementations, and the Enter one called the manager directly with no
  // catch -- a rejected send surfaced only as an unhandled promise rejection.
  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    handleSendClick();
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
    <div className="min-h-[100dvh] h-[100dvh] overflow-hidden bg-white dark:bg-gray-900 flex flex-col">
      <div className="container mx-auto max-w-7xl flex-1 flex flex-col md:flex-row min-h-0 gap-2 md:gap-6 px-2 pt-3 pb-2 md:px-4 md:py-4 overflow-hidden">
        {/* Header — top on mobile, sidebar on desktop */}
        <aside className="flex-shrink-0 md:w-[280px] md:overflow-y-auto">
          <PageHeader />
        </aside>

        {/* Main: character + input */}
        <main className="flex-1 flex flex-col gap-2 md:gap-4 min-h-0 overflow-hidden">
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
              realtimeAssistantDraft={realtimeAssistantDraft}
              realtimeInterruptedDraft={realtimeInterruptedDraft}
            />

            <ControlPanel
              onPlayExpression={playExpression}
              onPlayMotion={playMotion}
              onLookAt={playGaze}
              getAvailableExpressions={getAvailableExpressions}
              getAvailableMotionGroups={getAvailableMotionGroups}
            />

            <AvatarDebugPanel />
          </div>

          <SessionCapNotice />

          {/* Chat Input Area */}
          <ChatInput
            onSend={handleSendClick}
            onKeyPress={handleKeyPress}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onToggleRealtimeMode={toggleRealtimeMode}
            onInterruptRealtime={interruptRealtime}
          />
        </main>
      </div>
    </div>
  );
}
