import type { KeyboardEvent } from "react";
import { PaperAirplaneIcon, MicrophoneIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { useChatStore } from "../../stores/useChatStore";
import { RealtimeStatusBadge } from "./RealtimeStatusBadge";

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
    realtimeError,
    realtimeTurnStatus,
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
    <div className="flex-shrink-0 relative z-20">
      {isRealtimeMode && (
        <div className="mx-auto mb-1.5 flex w-full max-w-3xl justify-center md:max-w-[42rem]">
          <RealtimeStatusBadge
            visible={isRealtimeMode}
            status={realtimeTurnStatus}
            error={realtimeError}
          />
        </div>
      )}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-full border border-gray-200 bg-white px-2 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:max-w-[42rem] md:gap-2.5 md:px-2.5">
        {onToggleRealtimeMode && (
          <button
            onClick={() => void onToggleRealtimeMode()}
            disabled={isConnecting}
            className={`flex-shrink-0 rounded-full px-3 py-2 text-[13px] font-medium transition-all md:text-sm ${
              isRealtimeMode
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            } ${isConnecting ? "opacity-50 cursor-not-allowed" : ""}`}
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
                ? "Realtime ON"
                : "Realtime OFF"}
          </button>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyPress}
          placeholder={getPlaceholder()}
          className="min-w-0 flex-1 bg-transparent border-none focus:outline-none text-base text-gray-800 placeholder-gray-400 dark:text-white dark:placeholder-gray-500 px-1"
          disabled={disabled || isRecording || isTranscribing}
        />
        {onStartRecording && onStopRecording && !sttDisabled && (
          <button
            onClick={handleMicClick}
            disabled={disabled || isTranscribing}
            className={`flex-shrink-0 rounded-full p-2.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${getMicButtonClass()}`}
            title={
              isRecording
                ? "Stop recording"
                : isTranscribing
                  ? "Transcribing..."
                  : "Start recording"
            }
          >
            {isTranscribing ? (
              <ArrowPathIcon className="h-5 w-5 animate-spin" />
            ) : (
              <MicrophoneIcon className="h-5 w-5" />
            )}
          </button>
        )}
        <button
          onClick={onSend}
          disabled={disabled || !input.trim() || isRecording || isTranscribing}
          className="flex-shrink-0 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 p-2.5 text-white transition-all duration-200 hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PaperAirplaneIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
