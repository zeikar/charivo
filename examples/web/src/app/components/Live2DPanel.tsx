import type { RefObject } from "react";

import { SpeakingStatus } from "./chat/SpeakingStatus";

type Live2DPanelProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  isSpeaking: boolean;
};

export function Live2DPanel({
  canvasContainerRef,
  isSpeaking,
}: Live2DPanelProps) {
  return (
    <div className="lg:col-span-3 flex flex-col min-h-0">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-200 dark:border-gray-700 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">
              🎭 Meet Hiyori
            </h2>
            <div className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs font-medium">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              Online
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Your friendly AI assistant with Live2D animations
          </p>
        </div>

        {/* Character Showcase */}
        <div className="flex justify-center items-center flex-1 relative">
          <div
            ref={canvasContainerRef}
            className="flex justify-center items-center bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-gray-700 dark:to-gray-800 rounded-xl border-2 border-blue-200 dark:border-gray-600 relative overflow-hidden"
            style={{ width: 450, height: 600 }}
          >
            {/* Loading indicator when no canvas */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-500 dark:text-gray-400">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm">Loading Hiyori...</p>
              </div>
            </div>
          </div>
        </div>

        {/* Status and Features */}
        <div className="mt-4 space-y-3">
          {isSpeaking && <SpeakingStatus />}

          {/* Feature indicators */}
          <div className="flex justify-center gap-4 text-xs">
            <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              Live2D Rendering
            </div>
            <div className="flex items-center gap-1 text-purple-600 dark:text-purple-400">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
              Lip-Sync Active
            </div>
            <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              AI Ready
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-xs text-blue-800 dark:text-blue-300 text-center">
            💡 <strong>Try saying:</strong> "Hello Hiyori!", "How are you?", or
            "Tell me about yourself"
          </p>
        </div>
      </div>
    </div>
  );
}
