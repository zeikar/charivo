"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "../../types/chat";

type BubbleMessageProps = {
  message: ChatMessage;
  isLatest?: boolean;
};

export function BubbleMessage({
  message,
  isLatest = false,
}: BubbleMessageProps) {
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

  return (
    <div
      className={`transition-all duration-300 ${
        isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
      }`}
    >
      <div className="relative inline-block px-5 py-3 rounded-2xl shadow-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-600 max-w-md">
        {/* Speech bubble tail pointing right */}
        <div className="absolute right-0 top-4 w-0 h-0 -mr-2 border-t-[8px] border-t-transparent border-l-[12px] border-l-white dark:border-l-gray-700 border-b-[8px] border-b-transparent" />

        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    </div>
  );
}
