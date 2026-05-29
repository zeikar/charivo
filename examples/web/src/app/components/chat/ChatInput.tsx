import type { KeyboardEvent } from "react";
import {
  PaperAirplaneIcon,
  MicrophoneIcon,
  SignalIcon,
} from "@heroicons/react/24/outline";
import { ArrowPathIcon, StopIcon } from "@heroicons/react/24/solid";
import { useChatStore } from "../../stores/useChatStore";

type ChatInputProps = {
  onSend: () => void;
  onKeyPress: (event: KeyboardEvent<HTMLInputElement>) => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onToggleRealtimeMode?: () => void;
  onInterruptRealtime?: () => void;
};

type RealtimeUIState =
  | "off"
  | "connecting"
  | "listening"
  | "responding"
  | "reconnecting"
  | "error";

const REALTIME_STATE_CONFIG: Record<
  RealtimeUIState,
  { label: string; className: string; dotClass: string; pulse: boolean }
> = {
  off: {
    label: "Voice",
    className:
      "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600",
    dotClass: "",
    pulse: false,
  },
  connecting: {
    label: "Connecting",
    className:
      "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/70",
    dotClass: "bg-amber-500",
    pulse: true,
  },
  listening: {
    label: "Listening",
    className:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-800/70",
    dotClass: "bg-emerald-500",
    pulse: true,
  },
  responding: {
    label: "Responding",
    className:
      "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-200 dark:ring-blue-800/70",
    dotClass: "bg-blue-500",
    pulse: true,
  },
  reconnecting: {
    label: "Reconnecting",
    className:
      "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/70",
    dotClass: "bg-amber-500",
    pulse: true,
  },
  error: {
    label: "Error",
    className:
      "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/60 dark:text-red-200 dark:ring-red-800/70",
    dotClass: "bg-red-500",
    pulse: false,
  },
};

export function ChatInput({
  onSend,
  onKeyPress,
  onStartRecording,
  onStopRecording,
  onToggleRealtimeMode,
  onInterruptRealtime,
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

  const getRealtimeUIState = (): RealtimeUIState => {
    if (isConnecting) return "connecting";
    if (!isRealtimeMode) return "off";
    if (realtimeError) return "error";
    if (realtimeTurnStatus === "reconnecting") return "reconnecting";
    if (realtimeTurnStatus === "responding") return "responding";
    return "listening";
  };

  const realtimeState = getRealtimeUIState();
  const realtimeConfig = REALTIME_STATE_CONFIG[realtimeState];
  const canInterrupt =
    Boolean(onInterruptRealtime) && realtimeState === "responding";

  return (
    <div className="flex-shrink-0 relative z-20">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-full border border-gray-200 bg-white px-2 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:max-w-[42rem] md:gap-2.5 md:px-2.5">
        {onToggleRealtimeMode && (
          <button
            onClick={() => void onToggleRealtimeMode()}
            disabled={isConnecting}
            aria-label={
              isRealtimeMode
                ? "End voice conversation"
                : "Start voice conversation"
            }
            title={
              isConnecting
                ? "Connecting to voice mode..."
                : isRealtimeMode
                  ? "End voice conversation"
                  : "Start voice conversation"
            }
            className={`flex-shrink-0 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-all md:text-sm ${realtimeConfig.className} ${isConnecting ? "cursor-wait" : ""} disabled:cursor-not-allowed`}
          >
            {realtimeState === "off" ? (
              <SignalIcon className="h-4 w-4" aria-hidden />
            ) : (
              <span className="relative inline-flex h-2 w-2" aria-hidden>
                {realtimeConfig.pulse && (
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full ${realtimeConfig.dotClass} opacity-60 animate-ping`}
                  />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${realtimeConfig.dotClass}`}
                />
              </span>
            )}
            <span aria-live="polite">{realtimeConfig.label}</span>
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
            className={`flex-shrink-0 cursor-pointer rounded-full p-2.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 ${getMicButtonClass()}`}
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
        {canInterrupt && (
          <button
            onClick={() => onInterruptRealtime?.()}
            aria-label="Stop response"
            title="Stop response"
            className="flex-shrink-0 cursor-pointer rounded-full bg-red-500 p-2.5 text-white transition-all duration-200 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <StopIcon className="h-5 w-5" />
          </button>
        )}
        <button
          onClick={onSend}
          disabled={disabled || !input.trim() || isRecording || isTranscribing}
          className="flex-shrink-0 cursor-pointer rounded-full bg-gradient-to-r from-blue-500 to-blue-600 p-2.5 text-white transition-all duration-200 hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PaperAirplaneIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
