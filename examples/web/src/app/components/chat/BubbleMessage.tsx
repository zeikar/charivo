"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "../../types/chat";
import { useCharacterStore } from "../../stores/useCharacterStore";

type BubbleMessageProps = {
  message: ChatMessage;
  isLatest?: boolean;
};

function formatTimestamp(timestamp: Date | number | string) {
  if (timestamp instanceof Date) {
    return timestamp.toLocaleTimeString();
  }

  const date =
    typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleTimeString();
}

export function BubbleMessage({
  message,
  isLatest = false,
}: BubbleMessageProps) {
  const { selectedCharacter } = useCharacterStore();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isLatest) {
      // Animate in for latest message
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(true);
    }
  }, [isLatest]);

  const isUser = message.type === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4 transition-all duration-500 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div
        className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col`}
      >
        {!isUser && (
          <div className="flex items-center space-x-2 mb-2 px-1">
            <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-md">
              <span className="text-xs text-white font-bold">
                {selectedCharacter.charAt(0)}
              </span>
            </div>
            <span className="text-sm font-semibold text-purple-600 dark:text-purple-400">
              {selectedCharacter}
            </span>
          </div>
        )}

        <div
          className={`relative px-5 py-3 rounded-2xl shadow-lg ${
            isUser
              ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-br-sm"
              : "bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded-tl-sm border border-gray-200 dark:border-gray-600"
          }`}
        >
          {/* Speech bubble tail */}
          <div
            className={`absolute top-0 w-0 h-0 ${
              isUser
                ? "right-0 border-l-[12px] border-l-transparent border-t-[12px] border-t-blue-600"
                : "left-0 border-r-[12px] border-r-transparent border-t-[12px] border-t-white dark:border-t-gray-700"
            }`}
          />

          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
          <div
            className={`text-xs mt-2 ${
              isUser ? "text-blue-100" : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {formatTimestamp(message.timestamp)}
          </div>
        </div>
      </div>
    </div>
  );
}
