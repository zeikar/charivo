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

describe("Haru expression descriptions", () => {
  it("declares a non-empty description for exactly F01..F08", () => {
    const descriptions = CHARACTER_CONFIGS.Haru.live2d.expressionDescriptions;

    expect(descriptions).toBeDefined();
    expect(Object.keys(descriptions ?? {}).sort()).toEqual([
      "F01",
      "F02",
      "F03",
      "F04",
      "F05",
      "F06",
      "F07",
      "F08",
    ]);
    for (const value of Object.values(descriptions ?? {})) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
