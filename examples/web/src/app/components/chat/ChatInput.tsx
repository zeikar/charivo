import type { KeyboardEvent } from "react";
import { PaperAirplaneIcon } from "@heroicons/react/24/outline";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  onKeyPress,
  disabled = false,
}: ChatInputProps) {
  return (
    <div className="flex-shrink-0 h-16 flex items-center justify-center">
      <div className="w-full max-w-3xl">
        <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-full shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder="Type your message..."
            className="flex-1 bg-transparent border-none focus:outline-none text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            disabled={disabled}
          />
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="p-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
