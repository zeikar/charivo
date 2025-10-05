import type { RefObject } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

import {
  useCharacterStore,
  CHARACTERS,
  type CharacterName,
} from "../stores/useCharacterStore";

type Live2DPanelProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
};

export function Live2DPanel({ canvasContainerRef }: Live2DPanelProps) {
  const { selectedCharacter, setSelectedCharacter } = useCharacterStore();

  const handleCharacterSelect = (name: string) => {
    setSelectedCharacter(name as CharacterName);
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header with Character Selector */}
        <div className="absolute top-4 left-4 z-20">
          <Menu>
            {({ open }) => (
              <>
                <MenuButton className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer inline-flex items-center gap-2">
                  {selectedCharacter}
                  <ChevronDownIcon
                    className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </MenuButton>

                <MenuItems
                  anchor="bottom"
                  className="mt-2 ml-4 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl w-32 focus:outline-none z-50"
                >
                  {CHARACTERS.map((character) => (
                    <MenuItem key={character.id}>
                      {({ focus }) => (
                        <button
                          onClick={() => handleCharacterSelect(character.name)}
                          className={`w-full px-4 py-2 text-left transition-colors text-sm ${
                            character.name === selectedCharacter
                              ? "bg-blue-100 dark:bg-gray-600 text-blue-600 dark:text-blue-400 font-medium"
                              : focus
                                ? "bg-blue-50 dark:bg-gray-600 text-gray-800 dark:text-white"
                                : "text-gray-800 dark:text-white"
                          } first:rounded-t-lg last:rounded-b-lg`}
                        >
                          {character.name}
                        </button>
                      )}
                    </MenuItem>
                  ))}
                </MenuItems>
              </>
            )}
          </Menu>
        </div>

        {/* Character Showcase - Full Screen */}
        <div className="flex justify-center items-center flex-1 relative">
          <div
            ref={canvasContainerRef}
            className="w-full h-full flex justify-center items-center bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-gray-700 dark:to-gray-800 relative overflow-hidden"
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
      </div>
    </div>
  );
}
