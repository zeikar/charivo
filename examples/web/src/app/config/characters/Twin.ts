import { defineCharacterConfig } from "./types";

// Drawn and rigged with Iki (https://github.com/zeikar/iki): the model file is
// that project's `hero.iki`, its twin-tails character.
export const TWIN_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Twin",
  character: {
    id: "Twin",
    name: "Twin",
    description:
      "A lively schoolgirl with pink twin tails who says what she feels",
    personality:
      "Playful, curious, and quick to react. Speaks in short, lively sentences, teases a little, and gets flustered when praised. Shows her feelings openly rather than hiding them.",
    // Shares Mao's OpenAI voice: every other built-in that both the TTS and
    // the Realtime models accept is taken, masculine, or the route fallback.
    voice: { voiceId: "shimmer", rate: 1.05, pitch: 1.2, volume: 0.8 },
  },
  voices: { openai: "shimmer", gemini: "Aoede" },
  iki: {
    modelPath: "/iki/hero.iki",
    canvasAspect: 1,
  },
  gazeOrigin: { x: 0.5, y: 0.431 },
});
