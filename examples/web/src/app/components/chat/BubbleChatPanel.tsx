"use client";

import type { KeyboardEvent } from "react";
import { PaperAirplaneIcon } from "@heroicons/react/24/outline";
import type { ChatMessage } from "../../types/chat";
import { BubbleMessage } from "./BubbleMessage";

type BubbleChatPanelProps = {
  messages: ChatMessage[];
  isLoading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export function BubbleChatPanel({
  messages,
  isLoading,
  input,
  onInputChange,
  onSend,
  onKeyPress,
}: BubbleChatPanelProps) {
  // Get only character messages
  const characterMessages = messages.filter((msg) => msg.type === "character");

  // Show last 5 character messages with fading effect
  const maxVisibleMessages = 5;
  const visibleMessages = characterMessages.slice(-maxVisibleMessages);

  return (
    <>
      {/* Message Bubbles Area - Top Left */}
      <div className="absolute top-20 left-6 md:left-8 z-10 space-y-3">
        {/* Stacked Message Bubbles */}
        {visibleMessages.length > 0 && (
          <>
            {visibleMessages.map((message, index) => {
              // Calculate opacity: older messages (lower index) are more transparent
              // When there's only 1 message, it should be fully opaque (opacity = 1)
              const opacity =
                visibleMessages.length === 1
                  ? 1
                  : 0.3 + (index / (visibleMessages.length - 1)) * 0.7;
              return (
                <div key={message.id} style={{ opacity }}>
                  <BubbleMessage
                    message={message}
                    isLatest={index === visibleMessages.length - 1}
                  />
                </div>
              );
            })}
          </>
        )}

        {/* Loading Bubble */}
        {isLoading && (
          <div className="relative inline-block px-5 py-5 rounded-2xl shadow-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-600">
            {/* Speech bubble tail pointing right */}
            <div className="absolute right-0 top-4 w-0 h-0 -mr-2 border-t-[8px] border-t-transparent border-l-[12px] border-l-white dark:border-l-gray-700 border-b-[8px] border-b-transparent" />
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
          </div>
        )}
      </div>

      {/* Main Chat Interface */}
      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 space-y-3">
        {/* Input Area */}
        <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-full shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          {/* Input */}
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder="Type your message..."
            className="flex-1 bg-transparent border-none focus:outline-none text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            disabled={isLoading}
          />

          {/* Send Button */}
          <button
            onClick={onSend}
            disabled={isLoading || !input.trim()}
            className="p-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
}
