import { useState, useEffect } from "react";
import { Menu, MenuButton, MenuItems } from "@headlessui/react";
import {
  PlayIcon,
  ChevronDownIcon,
  FaceSmileIcon,
} from "@heroicons/react/24/outline";

type ControlPanelProps = {
  onPlayExpression: (expressionId: string) => void;
  onPlayMotion: (group: string, index: number) => void;
  getAvailableExpressions: () => string[];
  getAvailableMotionGroups: () => Record<string, number>;
};

export function ControlPanel({
  onPlayExpression,
  onPlayMotion,
  getAvailableExpressions,
  getAvailableMotionGroups,
}: ControlPanelProps) {
  const [expressions, setExpressions] = useState<string[]>([]);
  const [motionGroups, setMotionGroups] = useState<Record<string, number>>({});

  useEffect(() => {
    const updateAvailable = () => {
      const availableExpressions = getAvailableExpressions();
      const availableMotions = getAvailableMotionGroups();

      setExpressions(availableExpressions);
      setMotionGroups(availableMotions);
    };

    updateAvailable();
    const interval = setInterval(updateAvailable, 1000);
    return () => clearInterval(interval);
  }, [getAvailableExpressions, getAvailableMotionGroups]);

  const hasContent =
    expressions.length > 0 || Object.keys(motionGroups).length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="absolute bottom-4 left-4 z-20">
      <Menu>
        {({ open }) => (
          <>
            <MenuItems
              anchor={{ to: "top start", gap: "8px" }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl ring-1 ring-black/5 dark:ring-white/5 w-72 max-h-96 overflow-y-auto focus:outline-none z-50"
            >
              <div className="p-4 space-y-4">
                {/* Expressions */}
                {expressions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FaceSmileIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                        Expressions
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {expressions.map((expr) => (
                        <button
                          key={expr}
                          onClick={() => onPlayExpression(expr)}
                          className="px-3 py-2 text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          {expr}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Motions */}
                {Object.keys(motionGroups).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <PlayIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
                        Motions
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {Object.entries(motionGroups).map(([group, count]) => (
                        <div key={group}>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
                            {group} ({count})
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {Array.from({ length: count }, (_, i) => (
                              <button
                                key={i}
                                onClick={() => onPlayMotion(group, i)}
                                className="px-2 py-1.5 text-xs font-medium bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              >
                                #{i}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </MenuItems>

            <MenuButton className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg ring-1 ring-black/5 dark:ring-white/5 text-sm font-medium text-gray-800 dark:text-white hover:bg-white dark:hover:bg-gray-800 transition-all hover:shadow-xl inline-flex items-center gap-2">
              <PlayIcon className="w-4 h-4" />
              Controls
              <ChevronDownIcon
                className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </MenuButton>
          </>
        )}
      </Menu>
    </div>
  );
}
