import type { KeyboardEvent } from "react";
import { PaperAirplaneIcon, MicrophoneIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/24/solid";

type ChatInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  isRecording?: boolean;
  isTranscribing?: boolean;
  sttDisabled?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
};

export function ChatInput({
  value,
  onChange,
  onSend,
  onKeyPress,
  disabled = false,
  isRecording = false,
  isTranscribing = false,
  sttDisabled = false,
  onStartRecording,
  onStopRecording,
}: ChatInputProps) {
  const handleMicClick = () => {
    if (isRecording) {
      onStopRecording?.();
    } else {
      onStartRecording?.();
    }
  };

  const getPlaceholder = () => {
    if (isRecording) return "🎤 Recording...";
    if (isTranscribing) return "⏳ Transcribing...";
    return "Type your message...";
  };

  const getMicButtonClass = () => {
    if (isRecording) {
      return "bg-red-500 text-white animate-pulse";
    }
    if (isTranscribing) {
      return "bg-yellow-500 text-white";
    }
    return "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600";
  };

  return (
    <div className="flex-shrink-0 h-16 flex items-center justify-center relative z-20">
      <div className="w-full max-w-3xl">
        <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-full shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder={getPlaceholder()}
            className="flex-1 bg-transparent border-none focus:outline-none text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            disabled={disabled || isRecording || isTranscribing}
          />
          {onStartRecording && onStopRecording && !sttDisabled && (
            <button
              onClick={handleMicClick}
              disabled={disabled || isTranscribing}
              className={`p-2.5 rounded-full focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0 ${getMicButtonClass()}`}
              title={
                isRecording
                  ? "Stop recording"
                  : isTranscribing
                    ? "Transcribing..."
                    : "Start recording"
              }
            >
              {isTranscribing ? (
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
              ) : (
                <MicrophoneIcon className="w-5 h-5" />
              )}
            </button>
          )}
          <button
            onClick={onSend}
            disabled={
              disabled || !value.trim() || isRecording || isTranscribing
            }
            className="p-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
