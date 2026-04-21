import React from "react";
import type { ChatMessage } from "../../types/chat";

type MessageBubblesProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  realtimeAssistantDraft: string | null;
  realtimeInterruptedDraft: string | null;
};

export function MessageBubbles({
  messages,
  isLoading,
  realtimeAssistantDraft,
  realtimeInterruptedDraft,
}: MessageBubblesProps) {
  const characterMessages = messages.filter((msg) => msg.type === "character");
  const visibleMessages = characterMessages.slice(-3);
  const showLiveDraft = Boolean(realtimeAssistantDraft?.trim());
  const showInterruptedDraft =
    !showLiveDraft && Boolean(realtimeInterruptedDraft?.trim());

  return (
    <div className="absolute inset-x-3 bottom-26 md:top-20 md:left-8 md:right-auto md:bottom-auto z-10 space-y-2.5 md:space-y-3 pointer-events-none">
      {visibleMessages.map((message, index, arr) => {
        const opacity =
          arr.length === 1 ? 1 : 0.3 + (index / (arr.length - 1)) * 0.7;
        return (
          <div
            key={message.id}
            style={{ opacity }}
            className="md:block flex justify-center md:justify-start"
          >
            <div className="relative inline-block px-4 py-2.5 md:px-5 md:py-3 rounded-[1.6rem] md:rounded-2xl shadow-lg md:shadow-md bg-white/96 dark:bg-gray-700/96 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-600 max-w-[min(20rem,calc(100vw-3rem))] md:max-w-xs backdrop-blur-sm">
              <p className="text-sm">{message.content}</p>
              {/* Tail with border */}
              <div className="hidden md:block absolute top-[12px] -right-[10px]">
                {/* Outer triangle (border) */}
                <div className="w-0 h-0 border-l-[10px] border-l-gray-300 dark:border-l-gray-600 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
                {/* Inner triangle (fill) */}
                <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-white dark:border-l-gray-700 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
              </div>
            </div>
          </div>
        );
      })}
      {showLiveDraft && (
        <div className="md:block flex justify-center md:justify-start">
          <div className="relative inline-block px-4 py-2.5 md:px-5 md:py-3 rounded-[1.6rem] md:rounded-2xl shadow-lg md:shadow-md bg-blue-50/96 dark:bg-blue-950/60 text-gray-800 dark:text-white border border-blue-200 dark:border-blue-800 max-w-[min(20rem,calc(100vw-3rem))] md:max-w-xs backdrop-blur-sm">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-500 dark:text-blue-300">
              Live
            </div>
            <p className="text-sm">{realtimeAssistantDraft}</p>
            <div className="hidden md:block absolute top-[12px] -right-[10px]">
              <div className="w-0 h-0 border-l-[10px] border-l-blue-200 dark:border-l-blue-800 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
              <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-blue-50 dark:border-l-blue-950/60 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
            </div>
          </div>
        </div>
      )}

      {showInterruptedDraft && (
        <div className="md:block flex justify-center md:justify-start">
          <div className="relative inline-block px-4 py-2.5 md:px-5 md:py-3 rounded-[1.6rem] md:rounded-2xl shadow-lg md:shadow-md bg-amber-50/95 dark:bg-amber-950/40 text-gray-700 dark:text-amber-50 border border-amber-200 dark:border-amber-800/80 max-w-[min(20rem,calc(100vw-3rem))] md:max-w-xs opacity-90 backdrop-blur-sm">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-600 dark:text-amber-300">
              Interrupted
            </div>
            <p className="text-sm">{realtimeInterruptedDraft}</p>
            <div className="hidden md:block absolute top-[12px] -right-[10px]">
              <div className="w-0 h-0 border-l-[10px] border-l-amber-200 dark:border-l-amber-800/80 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
              <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-amber-50/90 dark:border-l-amber-950/40 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
            </div>
          </div>
        </div>
      )}

      {!showLiveDraft && !showInterruptedDraft && isLoading && (
        <div className="relative inline-block px-5 py-5 rounded-2xl shadow-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-300 dark:border-gray-600">
          <div className="flex items-center space-x-1.5">
            <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" />
            <div
              className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.15s" }}
            />
            <div
              className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.3s" }}
            />
          </div>
          {/* Tail with border */}
          <div className="absolute top-[16px] -right-[10px]">
            {/* Outer triangle (border) */}
            <div className="w-0 h-0 border-l-[10px] border-l-gray-300 dark:border-l-gray-600 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent" />
            {/* Inner triangle (fill) */}
            <div className="absolute top-0 left-0 w-0 h-0 border-l-[9px] border-l-white dark:border-l-gray-700 border-t-[7px] border-t-transparent border-b-[7px] border-b-transparent translate-x-[-1px]" />
          </div>
        </div>
      )}
    </div>
  );
}
