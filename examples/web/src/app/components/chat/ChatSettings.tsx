import type { ChangeEvent } from "react";

import type { LLMClientType, TTSPlayerType } from "../../types/chat";

type ChatSettingsProps = {
  selectedLLMClient: LLMClientType;
  onSelectLLMClient: (type: LLMClientType) => void;
  selectedTTSPlayer: TTSPlayerType;
  onSelectTTSPlayer: (type: TTSPlayerType) => void;
  llmError: string | null;
  ttsError: string | null;
};

type Option<T> = {
  label: string;
  value: T;
  description: string;
};

const LLM_OPTIONS: Option<LLMClientType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "🌐 Calls server LLM API (secure, recommended)",
  },
  {
    label: "OpenAI Direct",
    value: "openai",
    description: "⚡ Direct OpenAI API (test only, requires API key)",
  },
  {
    label: "Test Stub",
    value: "stub",
    description: "🎭 Mock responses for testing (no API calls)",
  },
];

const TTS_OPTIONS: Option<TTSPlayerType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "🌐 Calls server TTS API (secure)",
  },
  {
    label: "Browser TTS",
    value: "web",
    description: "🔊 Uses browser's built-in TTS",
  },
  {
    label: "OpenAI Direct",
    value: "openai",
    description: "⚡ Direct OpenAI API (test only)",
  },
  {
    label: "Disabled",
    value: "none",
    description: "🔇 No voice synthesis",
  },
];

export function ChatSettings({
  selectedLLMClient,
  onSelectLLMClient,
  selectedTTSPlayer,
  onSelectTTSPlayer,
  llmError,
  ttsError,
}: ChatSettingsProps) {
  const handleLLMChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectLLMClient(event.target.value as LLMClientType);
  };

  const handleTTSChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSelectTTSPlayer(event.target.value as TTSPlayerType);
  };

  return (
    <div className="bg-blue-500 dark:bg-blue-600 p-4">
      <h2 className="text-lg font-semibold text-white mb-1">
        💬 AI Chat Interface
      </h2>
      <p className="text-blue-100 text-xs mb-3">
        Modular LLM + TTS integration with multiple providers
      </p>

      <div className="space-y-3 mb-4">
        <div className="text-sm font-medium text-white">
          🧠 LLM Client Options:
        </div>
        <div className="grid grid-cols-3 gap-2">
          {LLM_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer"
            >
              <input
                type="radio"
                name="llmClient"
                value={option.value}
                checked={selectedLLMClient === option.value}
                onChange={handleLLMChange}
                className="text-blue-500"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="text-xs text-blue-200 bg-blue-600/50 p-2 rounded">
          {
            LLM_OPTIONS.find((option) => option.value === selectedLLMClient)
              ?.description
          }
        </div>
        {llmError && (
          <div className="text-xs text-red-200 bg-red-600/50 p-2 rounded">
            ⚠️ {llmError}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="text-sm font-medium text-white">
          🔊 TTS Player Options:
        </div>
        <div className="grid grid-cols-2 gap-2">
          {TTS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center space-x-2 text-xs text-blue-100 cursor-pointer"
            >
              <input
                type="radio"
                name="ttsPlayer"
                value={option.value}
                checked={selectedTTSPlayer === option.value}
                onChange={handleTTSChange}
                className="text-blue-500"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="text-xs text-blue-200 bg-blue-600/50 p-2 rounded">
          {
            TTS_OPTIONS.find((option) => option.value === selectedTTSPlayer)
              ?.description
          }
        </div>
        {ttsError && (
          <div className="text-xs text-red-200 bg-red-600/50 p-2 rounded">
            ⚠️ {ttsError}
          </div>
        )}
      </div>
    </div>
  );
}
