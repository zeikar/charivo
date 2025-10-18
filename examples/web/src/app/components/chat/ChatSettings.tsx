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
};

const LLM_OPTIONS: Option<LLMClientType>[] = [
  {
    label: "Remote API",
    value: "remote",
    description: "Calls server LLM API (secure, recommended)",
    Icon: GlobeAltIcon,
  },
  {
    label: "OpenAI Direct",
    value: "openai",
    description: "Direct OpenAI API (test only, requires API key)",
    Icon: BoltIcon,
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
    description: "Calls server TTS API (secure)",
    Icon: GlobeAltIcon,
  },
  {
    label: "Browser TTS",
    value: "web",
    description: "Uses browser's built-in TTS",
    Icon: SpeakerWaveIcon,
  },
  {
    label: "OpenAI Direct",
    value: "openai",
    description: "Direct OpenAI API (test only)",
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
    description: "Calls server STT API (secure)",
    Icon: GlobeAltIcon,
  },
  {
    label: "Browser STT",
    value: "web",
    description: "Uses browser's built-in speech recognition",
    Icon: MicrophoneIcon,
  },
  {
    label: "OpenAI Direct",
    value: "openai",
    description: "Direct OpenAI API (test only)",
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
          className="mt-2 mr-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-72 overflow-hidden focus:outline-none"
        >
          {/* LLM Settings */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🧠</span>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                LLM Client
              </h3>
            </div>
            <div className="space-y-2">
              {LLM_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onSelectLLMClient(option.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                    selectedLLMClient === option.value
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                      : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <option.Icon className="w-4 h-4" />
                    <span>{option.label}</span>
                  </div>
                </button>
              ))}
            </div>
            {selectedLLM && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {selectedLLM.description}
              </p>
            )}
            {llmError && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded">
                ⚠️ {llmError}
              </div>
            )}
          </div>

          {/* TTS Settings */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3">
              <SpeakerWaveIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                TTS Player
              </h3>
            </div>
            <div className="space-y-2">
              {TTS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onSelectTTSPlayer(option.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                    selectedTTSPlayer === option.value
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                      : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <option.Icon className="w-4 h-4" />
                    <span>{option.label}</span>
                  </div>
                </button>
              ))}
            </div>
            {selectedTTS && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {selectedTTS.description}
              </p>
            )}
            {ttsError && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded">
                ⚠️ {ttsError}
              </div>
            )}
          </div>

          {/* STT Settings */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <MicrophoneIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
              <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                STT Transcriber
              </h3>
            </div>
            <div className="space-y-2">
              {STT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onSelectSTTTranscriber(option.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                    selectedSTTTranscriber === option.value
                      ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                      : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <option.Icon className="w-4 h-4" />
                    <span>{option.label}</span>
                  </div>
                </button>
              ))}
            </div>
            {selectedSTT && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {selectedSTT.description}
              </p>
            )}
            {sttError && (
              <div className="text-xs text-red-600 dark:text-red-400 mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded">
                ⚠️ {sttError}
              </div>
            )}
          </div>
        </MenuItems>
      </Menu>
    </div>
  );
}
