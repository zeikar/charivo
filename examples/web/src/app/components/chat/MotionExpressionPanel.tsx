import { useState, useEffect } from "react";
import {
  FaceSmileIcon,
  PlayIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";

type MotionExpressionPanelProps = {
  onPlayExpression: (expressionId: string) => void;
  onPlayMotion: (group: string, index: number) => void;
  getAvailableExpressions: () => string[];
  getAvailableMotionGroups: () => Record<string, number>;
};

export function MotionExpressionPanel({
  onPlayExpression,
  onPlayMotion,
  getAvailableExpressions,
  getAvailableMotionGroups,
}: MotionExpressionPanelProps) {
  const [expressions, setExpressions] = useState<string[]>([]);
  const [motionGroups, setMotionGroups] = useState<Record<string, number>>({});
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateAvailable = () => {
      const availableExpressions = getAvailableExpressions();
      const availableMotions = getAvailableMotionGroups();

      setExpressions(availableExpressions);
      setMotionGroups(availableMotions);
    };

    updateAvailable();
    // Poll for updates in case model loads later
    const interval = setInterval(updateAvailable, 1000);
    return () => clearInterval(interval);
  }, [getAvailableExpressions, getAvailableMotionGroups]);

  const hasContent =
    expressions.length > 0 || Object.keys(motionGroups).length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-1.5 text-left text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between"
      >
        <span className="flex items-center gap-1.5">
          <PlayIcon className="w-3 h-3" />
          Controls
        </span>
        <ChevronDownIcon
          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="px-2 pb-2 space-y-2 max-h-96 overflow-y-auto">
          {/* Expressions */}
          {expressions.length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 px-1">
                Expressions ({expressions.length})
              </label>
              <div className="grid grid-cols-2 gap-1">
                {expressions.map((expr) => (
                  <button
                    key={expr}
                    onClick={() => onPlayExpression(expr)}
                    className="px-2 py-1 text-[10px] font-medium bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-500 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all flex items-center justify-center gap-1"
                  >
                    <FaceSmileIcon className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{expr}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Motions */}
          {Object.keys(motionGroups).length > 0 && (
            <div>
              <label className="block text-[10px] font-medium text-gray-600 dark:text-gray-400 mb-1 px-1">
                Motions
              </label>
              <div className="space-y-1.5">
                {Object.entries(motionGroups).map(([group, count]) => (
                  <div key={group}>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-0.5 font-medium px-1">
                      {group} ({count})
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {Array.from({ length: count }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => onPlayMotion(group, i)}
                          className="px-1.5 py-1 text-[10px] font-medium bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600 hover:bg-green-50 dark:hover:bg-green-900/30 hover:border-green-500 dark:hover:border-green-500 hover:text-green-600 dark:hover:text-green-400 transition-all flex items-center justify-center gap-0.5"
                        >
                          <PlayIcon className="w-2 h-2 flex-shrink-0" />#{i}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
