import type { RefObject } from "react";
import { useState } from "react";

import { SpeakingStatus } from "./chat/SpeakingStatus";
import { useLive2DStore, LIVE2D_MODELS } from "../stores/useLive2DStore";

type Live2DPanelProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  isSpeaking: boolean;
};

export function Live2DPanel({
  canvasContainerRef,
  isSpeaking,
}: Live2DPanelProps) {
  const { selectedModel, setSelectedModel } = useLive2DStore();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleModelSelect = (modelName: string) => {
    setSelectedModel(modelName as (typeof LIVE2D_MODELS)[number]);
    setIsDropdownOpen(false);
  };

  return (
    <div className="lg:col-span-3 flex flex-col min-h-0">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-700 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="text-center mb-4 relative">
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="text-lg font-bold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer inline-flex items-center gap-2"
          >
            {selectedModel}
            <svg
              className={`w-4 h-4 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-10 min-w-[150px]">
              {LIVE2D_MODELS.map((model) => (
                <button
                  key={model}
                  onClick={() => handleModelSelect(model)}
                  className={`w-full px-4 py-2 text-left hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors ${
                    model === selectedModel
                      ? "bg-blue-100 dark:bg-gray-600 text-blue-600 dark:text-blue-400"
                      : "text-gray-800 dark:text-white"
                  } first:rounded-t-lg last:rounded-b-lg`}
                >
                  {model}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Character Showcase */}
        <div className="flex justify-center items-center flex-1 relative">
          <div
            ref={canvasContainerRef}
            className="flex justify-center items-center bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-gray-700 dark:to-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 relative overflow-hidden"
            style={{ width: 450, height: 600 }}
          >
            {/* Loading indicator when no canvas */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-500 dark:text-gray-400">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm">Loading...</p>
              </div>
            </div>
          </div>
        </div>

        {/* Status */}
        {isSpeaking && (
          <div className="mt-4">
            <SpeakingStatus />
          </div>
        )}
      </div>
    </div>
  );
}
