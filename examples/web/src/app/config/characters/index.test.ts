import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/** Expression IDs a Live2D model actually ships, read from its model3.json. */
function readModelExpressionIds(modelPath: string): string[] {
  const publicDir = fileURLToPath(
    new URL("../../../../public", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${publicDir}${modelPath}`, "utf8"),
  ) as { FileReferences?: { Expressions?: Array<{ Name: string }> } };

  return (manifest.FileReferences?.Expressions ?? []).map((e) => e.Name);
}

// `@charivo/avatar` silently ignores description keys that are not in the
// catalog's expression list, so a typo'd or stale key is a no-op rather than an
// error. These assertions are what turn that into a caught mistake.
describe("expression descriptions", () => {
  const documented = CHARACTER_IDS.filter(
    (id) => CHARACTER_CONFIGS[id].live2d.expressionDescriptions !== undefined,
  );

  it("covers the characters whose model IDs are opaque", () => {
    expect(documented.sort()).toEqual(["Haru", "Mao"]);
  });

  for (const id of documented) {
    it(`${id}: every key names a real expression, with a non-empty value`, () => {
      const { modelPath, expressionDescriptions } =
        CHARACTER_CONFIGS[id].live2d;
      const declared = Object.keys(expressionDescriptions ?? {}).sort();

      expect(declared).toEqual(readModelExpressionIds(modelPath).sort());
      for (const value of Object.values(expressionDescriptions ?? {})) {
        expect(typeof value).toBe("string");
        expect(value.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
