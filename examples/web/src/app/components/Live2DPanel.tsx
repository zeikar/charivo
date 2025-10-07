import type { RefObject } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

import {
  useCharacterStore,
  CHARACTERS,
  type CharacterId,
} from "../stores/useCharacterStore";

type Live2DPanelProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
};

export function Live2DPanel({ canvasContainerRef }: Live2DPanelProps) {
  const { selectedCharacter, setSelectedCharacter } = useCharacterStore();

  const handleCharacterSelect = (id: string) => {
    setSelectedCharacter(id as CharacterId);
  };

  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden shadow-2xl ring-1 ring-gray-200/50 dark:ring-gray-700/50">
      {/* Background with gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-800 dark:via-gray-900 dark:to-gray-800" />

      {/* Character Selector */}
      <div className="absolute top-4 left-4 z-20">
        <Menu>
          {({ open }) => (
            <>
              <MenuButton className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-full shadow-lg ring-1 ring-black/5 dark:ring-white/5 text-sm font-bold text-gray-800 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-all hover:shadow-xl inline-flex items-center gap-2">
                {selectedCharacter}
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
                />
              </MenuButton>

              <MenuItems
                anchor="bottom"
                className="mt-2 ml-4 bg-white dark:bg-gray-700 rounded-lg shadow-xl ring-1 ring-black/5 dark:ring-white/5 w-32 focus:outline-none z-50"
              >
                {CHARACTERS.map((character) => (
                  <MenuItem key={character.id}>
                    {({ focus }) => (
                      <button
                        onClick={() => handleCharacterSelect(character.id)}
                        className={`w-full px-4 py-2 text-left transition-colors text-sm ${
                          character.id === selectedCharacter
                            ? "bg-blue-100 dark:bg-gray-600 text-blue-600 dark:text-blue-400 font-medium"
                            : focus
                              ? "bg-blue-50 dark:bg-gray-600 text-gray-800 dark:text-white"
                              : "text-gray-800 dark:text-white"
                        } first:rounded-t-lg last:rounded-b-lg`}
                      >
                        {character.id}
                      </button>
                    )}
                  </MenuItem>
                ))}
              </MenuItems>
            </>
          )}
        </Menu>
      </div>

      {/* Canvas Container */}
      <div
        ref={canvasContainerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
      >
        {/* Loading indicator */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400 dark:text-gray-500">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            <p className="text-sm">Loading...</p>
          </div>
        </div>
      </div>
    </div>
  );
}
