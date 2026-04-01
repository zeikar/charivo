"use client";

import { Menu, MenuButton, MenuItems } from "@headlessui/react";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import {
  GlobeAltIcon,
  BoltIcon,
  FaceSmileIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  MicrophoneIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/solid";
import type {
  LLMClientType,
  TTSPlayerType,
  STTTranscriberType,
} from "../../types/chat";

type ChatSettingsProps = {
  selectedLLMClient: LLMClientType;
  onSelectLLMClient: (type: LLMClientType) => void;
  selectedTTSPlayer: TTSPlayerType;
  onSelectTTSPlayer: (type: TTSPlayerType) => void;
  selectedSTTTranscriber: STTTranscriberType;
  onSelectSTTTranscriber: (type: STTTranscriberType) => void;
  llmError: string | null;
  ttsError: string | null;
  sttError: string | null;
};

type Option<T> = {
  label: string;
  value: T;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  corsWarning?: boolean;
};

const LLM_OPTIONS: Option<LLMClientType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "Calls a server LLM route. Secure, production-ready default.",
    Icon: GlobeAltIcon,
  },
  {
    label: "OpenAI Direct (Dev)",
    value: "openai",
    description: "Direct browser key usage. Development/testing only.",
    Icon: BoltIcon,
  },
  {
    label: "OpenClaw Proxy",
    value: "openclaw-remote",
    description: "OpenClaw through your server route. Safer than direct mode.",
    Icon: CpuChipIcon,
  },
  {
    label: "OpenClaw Direct (Dev)",
    value: "openclaw",
    description: "Development/testing only. Browser CORS issues are common.",
    Icon: CpuChipIcon,
    corsWarning: true,
  },
  {
    label: "Test Stub",
    value: "stub",
    description: "Mock responses for testing (no API calls)",
    Icon: FaceSmileIcon,
  },
];

const TTS_OPTIONS: Option<TTSPlayerType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "Calls a server TTS route. Secure, production-ready default.",
    Icon: GlobeAltIcon,
  },
  {
    label: "Browser TTS",
    value: "web",
    description: "Uses browser's built-in TTS",
    Icon: SpeakerWaveIcon,
  },
  {
    label: "OpenAI Direct (Dev)",
    value: "openai",
    description: "Direct browser key usage. Development/testing only.",
    Icon: BoltIcon,
  },
  {
    label: "Disabled",
    value: "none",
    description: "No voice synthesis",
    Icon: SpeakerXMarkIcon,
  },
];

const STT_OPTIONS: Option<STTTranscriberType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "Calls a server STT route. Secure, production-ready default.",
    Icon: GlobeAltIcon,
  },
  {
    label: "Browser STT",
    value: "web",
    description: "Uses browser's built-in speech recognition",
    Icon: MicrophoneIcon,
  },
  {
    label: "OpenAI Direct (Dev)",
    value: "openai",
    description: "Direct browser key usage. Development/testing only.",
    Icon: BoltIcon,
  },
  {
    label: "Disabled",
    value: "none",
    description: "No speech recognition",
    Icon: SpeakerXMarkIcon,
  },
];

export function ChatSettings({
  selectedLLMClient,
  onSelectLLMClient,
  selectedTTSPlayer,
  onSelectTTSPlayer,
  selectedSTTTranscriber,
  onSelectSTTTranscriber,
  llmError,
  ttsError,
  sttError,
}: ChatSettingsProps) {
  const selectedLLM = LLM_OPTIONS.find(
    (opt) => opt.value === selectedLLMClient,
  );
  const selectedTTS = TTS_OPTIONS.find(
    (opt) => opt.value === selectedTTSPlayer,
  );
  const selectedSTT = STT_OPTIONS.find(
    (opt) => opt.value === selectedSTTTranscriber,
  );

  return (
    <div className="absolute top-4 right-4 z-20">
      <Menu>
        <MenuButton className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-800 dark:text-white hover:bg-white dark:hover:bg-gray-800 transition-colors inline-flex items-center gap-2">
          <Cog6ToothIcon className="w-4 h-4" />
          Settings
        </MenuButton>

        <MenuItems
          anchor="bottom end"
          transition
          className="mt-2 mr-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-72 focus:outline-none"
        >
          <div className="max-h-[420px] overflow-y-auto">
            {/* LLM Settings */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-base">🧠</span>
                <h3 className="text-xs font-semibold text-gray-800 dark:text-white">
                  LLM Client
                </h3>
              </div>
              <div className="space-y-1">
                {LLM_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onSelectLLMClient(option.value)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      selectedLLMClient === option.value
                        ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <option.Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{option.label}</span>
                      {option.corsWarning && (
                        <ExclamationTriangleIcon className="w-3 h-3 text-yellow-500 shrink-0 ml-auto" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {selectedLLM && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  {selectedLLM.description}
                </p>
              )}
              {selectedLLM?.corsWarning && (
                <div className="text-xs text-yellow-700 dark:text-yellow-400 mt-1.5 p-1.5 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                  ⚠️ CORS 이슈로 브라우저에서 직접 연결이 차단될 수 있습니다.
                </div>
              )}
              {llmError && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1.5 p-1.5 bg-red-50 dark:bg-red-900/20 rounded">
                  ⚠️ {llmError}
                </div>
              )}
            </div>

            {/* TTS Settings */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-1.5 mb-2">
                <SpeakerWaveIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                <h3 className="text-xs font-semibold text-gray-800 dark:text-white">
                  TTS Player
                </h3>
              </div>
              <div className="space-y-1">
                {TTS_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onSelectTTSPlayer(option.value)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      selectedTTSPlayer === option.value
                        ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <option.Icon className="w-3.5 h-3.5" />
                      <span>{option.label}</span>
                    </div>
                  </button>
                ))}
              </div>
              {selectedTTS && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  {selectedTTS.description}
                </p>
              )}
              {ttsError && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1.5 p-1.5 bg-red-50 dark:bg-red-900/20 rounded">
                  ⚠️ {ttsError}
                </div>
              )}
            </div>

            {/* STT Settings */}
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <MicrophoneIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                <h3 className="text-xs font-semibold text-gray-800 dark:text-white">
                  STT Transcriber
                </h3>
              </div>
              <div className="space-y-1">
                {STT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => onSelectSTTTranscriber(option.value)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      selectedSTTTranscriber === option.value
                        ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                        : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <option.Icon className="w-3.5 h-3.5" />
                      <span>{option.label}</span>
                    </div>
                  </button>
                ))}
              </div>
              {selectedSTT && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  {selectedSTT.description}
                </p>
              )}
              {sttError && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1.5 p-1.5 bg-red-50 dark:bg-red-900/20 rounded">
                  ⚠️ {sttError}
                </div>
              )}
            </div>
          </div>
        </MenuItems>
      </Menu>
    </div>
  );
}
