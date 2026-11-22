import { defineCharacterConfig } from "./types";

// Drawn and rigged with Iki (https://github.com/zeikar/iki): that project's
// full-body `mint.iki`.
const VIEW = { x: 0, y: 0, width: 1.6 * 1100, height: 3692 };

export const MINT_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Mint",
  character: {
    id: "Mint",
    name: "Mint",
    description:
      "An easygoing girl in a hoodie and sneakers who takes things as they come",
    personality:
      "Relaxed, friendly, and a little dry. Speaks casually and unhurriedly, waves hello, and would rather joke about a problem than fret over it. Warm underneath the laid-back tone.",
    // Shares Hiyori's OpenAI voice, for the reason Twin shares Mao's.
    voice: { voiceId: "marin", rate: 1.0, pitch: 1.1, volume: 0.8 },
  },
  voices: { openai: "marin", gemini: "Callirrhoe" },
  iki: {
    modelPath: "/iki/mint.iki",
    // Her box is 1100 wide; 1.6 times that keeps the waving hand on canvas.
    view: VIEW,
    canvasAspect: VIEW.width / VIEW.height,
  },
  gazeOrigin: { x: 0.5, y: 0.125 },
});
