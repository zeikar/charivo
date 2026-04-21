import { describe, expect, it } from "vitest";
import { CHARACTER_CONFIGS, CHARACTER_IDS } from "./index";

const EXPECTED_VOICE_IDS = {
  Haru: "coral",
  Hiyori: "marin",
  Mao: "shimmer",
  Mark: "cedar",
  Natori: "verse",
  Rice: "ballad",
  Wanko: "alloy",
} as const;

const BUILT_IN_DEMO_VOICES = new Set([
  "alloy",
  "ballad",
  "cedar",
  "coral",
  "marin",
  "shimmer",
  "verse",
]);

describe("demo character voice defaults", () => {
  it("assigns an explicit curated voiceId to every demo character", () => {
    for (const id of CHARACTER_IDS) {
      const voiceId = CHARACTER_CONFIGS[id].character.voice?.voiceId;

      expect(voiceId).toBe(EXPECTED_VOICE_IDS[id]);
      expect(BUILT_IN_DEMO_VOICES.has(voiceId ?? "")).toBe(true);
    }
  });
});
