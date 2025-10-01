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
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-700 flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="text-center mb-4">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">
            Hiyori
          </h2>
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
