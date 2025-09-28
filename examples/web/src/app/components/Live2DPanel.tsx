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
    <div className="lg:col-span-3 flex flex-col">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg h-full flex flex-col">
        <div className="text-center mb-3">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">
            🎮 Live2D Character
          </h2>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Powered by Charivo Framework
          </p>
        </div>

        <div className="flex justify-center items-center flex-1">
          <div
            ref={canvasContainerRef}
            className="flex justify-center items-center bg-gradient-to-b from-blue-50 to-blue-100 dark:from-gray-700 dark:to-gray-800 rounded-lg"
            style={{ width: 450, height: 600 }}
          />
        </div>

        {isSpeaking && <SpeakingStatus />}
      </div>
    </div>
  );
}
