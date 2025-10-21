import type { KeyboardEvent } from "react";
import { PaperAirplaneIcon, MicrophoneIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { useChatStore } from "../../stores/useChatStore";

type ChatInputProps = {
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onToggleRealtimeMode?: () => void;
};

export function ChatInput({
  onSend,
  onKeyPress,
  onStartRecording,
  onStopRecording,
  onToggleRealtimeMode,
}: ChatInputProps) {
  const {
    input,
    setInput,
    isLoading,
    isRecording,
    isTranscribing,
    selectedSTTTranscriber,
    isRealtimeMode,
    isConnecting,
    isConnected,
    realtimeError,
  } = useChatStore();

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

  const sttDisabled = selectedSTTTranscriber === "none" || isRealtimeMode;
  const disabled = isLoading || isConnecting;

  return (
    <div className="flex-shrink-0 h-16 flex items-center justify-center relative z-20">
      <div className="w-full max-w-full flex items-center justify-center gap-3">
        {/* Realtime Mode Toggle Button */}
        {onToggleRealtimeMode && (
          <div className="flex-shrink-0">
            <button
              onClick={() => void onToggleRealtimeMode()}
              disabled={isConnecting}
              className={`
                px-4 py-2.5 rounded-full font-medium transition-all shadow-lg
                ${
                  isRealtimeMode
                    ? "bg-green-500 text-white hover:bg-green-600"
                    : "bg-gray-700 text-white hover:bg-gray-600"
                }
                ${isConnecting ? "opacity-50 cursor-not-allowed" : ""}
              `}
              title={
                isConnecting
                  ? "Connecting to realtime mode..."
                  : isRealtimeMode
                    ? "Disable realtime mode"
                    : "Enable realtime mode"
              }
            >
              {isConnecting
                ? "Connecting..."
                : isRealtimeMode
                  ? "🌐 Realtime ON"
                  : "🌐 Realtime OFF"}
            </button>
            {isRealtimeMode && isConnected && (
              <div className="mt-1 text-xs text-green-400 font-medium text-center">
                ✓ Connected
              </div>
            )}
            {realtimeError && (
              <div className="mt-1 text-xs text-red-400 font-medium text-center">
                ✗ Error
              </div>
            )}
          </div>
        )}

        <div className="flex-1 max-w-3xl">
          <div className="flex items-center space-x-2 bg-white dark:bg-gray-800 rounded-full shadow-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
                disabled || !input.trim() || isRecording || isTranscribing
              }
              className="p-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex-shrink-0"
            >
              <PaperAirplaneIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
