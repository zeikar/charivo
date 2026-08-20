import type { KeyboardEvent } from "react";
import {
  PaperAirplaneIcon,
  MicrophoneIcon,
  PhoneIcon,
  PhoneXMarkIcon,
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

/**
 * What the session is doing. Shown as text, never as the button's label — the
 * button has to keep saying what pressing it does, and while a call is up that
 * is always "hang up".
 */
const REALTIME_STATUS_TEXT: Record<RealtimeUIState, string> = {
  off: "",
  connecting: "Connecting\u2026",
  listening: "Listening \u2014 speak or type",
  responding: "Responding\u2026",
  reconnecting: "Reconnecting\u2026",
  error: "Voice chat error",
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
    if (realtimeStatusText) return realtimeStatusText;
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
  const realtimeStatusText = REALTIME_STATUS_TEXT[realtimeState];
  const canInterrupt =
    Boolean(onInterruptRealtime) && realtimeState === "responding";
  // A call is up (or coming up) for every state but "off", and the one thing
  // the button can offer then is ending it.
  const callIsUp = realtimeState !== "off" && realtimeState !== "connecting";

  return (
    <div className="flex-shrink-0 relative z-20">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-full border border-gray-200 bg-white px-2 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:max-w-[42rem] md:gap-2.5 md:px-2.5">
        {onToggleRealtimeMode && (
          <button
            onClick={() => void onToggleRealtimeMode()}
            disabled={isConnecting}
            aria-label={
              callIsUp ? "End voice conversation" : "Start voice conversation"
            }
            title={
              isConnecting
                ? "Connecting to voice chat..."
                : callIsUp
                  ? "End voice conversation"
                  : "Start voice conversation — talk out loud, or keep typing"
            }
            className={`flex-shrink-0 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-all md:text-sm ${
              isConnecting
                ? "cursor-wait bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-800/70"
                : callIsUp
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
            } disabled:cursor-not-allowed`}
          >
            {isConnecting ? (
              <span className="relative inline-flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
            ) : callIsUp ? (
              <PhoneXMarkIcon className="h-4 w-4" aria-hidden />
            ) : (
              <PhoneIcon className="h-4 w-4" aria-hidden />
            )}
            <span>
              {isConnecting ? "Connecting" : callIsUp ? "End" : "Talk"}
            </span>
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {realtimeStatusText}
        </span>
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
