import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_CONFIGS,
  CHARACTER_IDS,
  resolveCharacterVoice,
} from "./index";

const EXPECTED_VOICE_IDS = {
  Haru: "coral",
  Hiyori: "marin",
  Mao: "shimmer",
  Mark: "cedar",
  Natori: "verse",
  Rice: "ballad",
  Wanko: "alloy",
} as const;

const EXPECTED_GEMINI_VOICE_IDS = {
  Haru: "Zephyr",
  Hiyori: "Achernar",
  Mao: "Puck",
  Mark: "Charon",
  Natori: "Despina",
  Rice: "Leda",
  Wanko: "Fenrir",
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

// Local copy of ALLOWED_VOICES from packages/server/src/gemini/realtime/index.ts:
// that set is module-private, so the demo's own allow-list is derived from the
// characters and checked against this copy instead of importing it.
const GEMINI_PREBUILT_VOICES = new Set([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]);

describe("demo character voice defaults", () => {
  it("assigns an explicit curated voiceId to every demo character", () => {
    for (const id of CHARACTER_IDS) {
      const voiceId = CHARACTER_CONFIGS[id].character.voice?.voiceId;

      expect(voiceId).toBe(EXPECTED_VOICE_IDS[id]);
      expect(BUILT_IN_DEMO_VOICES.has(voiceId ?? "")).toBe(true);
    }
  });

  it("maps voices.openai to the character's own voiceId and voices.gemini to a curated prebuilt voice", () => {
    for (const id of CHARACTER_IDS) {
      const { character, voices } = CHARACTER_CONFIGS[id];

      expect(voices.openai).toBe(character.voice?.voiceId);
      expect(voices.gemini).toBe(EXPECTED_GEMINI_VOICE_IDS[id]);
      expect(GEMINI_PREBUILT_VOICES.has(voices.gemini)).toBe(true);
    }
  });
});

describe("resolveCharacterVoice", () => {
  it("swaps in the gemini voiceId and leaves every other field equal to the original", () => {
    const original = CHARACTER_CONFIGS.Haru;
    const originalVoiceId = original.character.voice?.voiceId;

    const resolved = resolveCharacterVoice(original, "gemini");

    expect(resolved).toEqual({
      ...original.character,
      voice: { ...original.character.voice, voiceId: "Zephyr" },
    });
    expect(original.character.voice?.voiceId).toBe(originalVoiceId);
  });

  it("resolves the openai provider to the character's existing voiceId", () => {
    const resolved = resolveCharacterVoice(CHARACTER_CONFIGS.Haru, "openai");

    expect(resolved.voice?.voiceId).toBe("coral");
  });
});

/** Expression IDs a Live2D model actually ships, read from its model3.json. */
function readModelMotionFiles(modelPath: string): Record<string, string[]> {
  const publicDir = fileURLToPath(
    new URL("../../../../public", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${publicDir}${modelPath}`, "utf8"),
  ) as {
    FileReferences?: { Motions?: Record<string, Array<{ File: string }>> };
  };

  return Object.fromEntries(
    Object.entries(manifest.FileReferences?.Motions ?? {}).map(
      ([group, entries]) => [group, entries.map((entry) => entry.File)],
    ),
  );
}

// Motion descriptions are POSITIONAL, so counts alone cannot protect them: an
// SDK asset refresh that reorders or swaps files inside a group would remap
// every description while every count still matched. These are the ordered
// files that were on disk when the motions were watched.
const EXPECTED_MOTION_FILES: Record<string, Record<string, string[]>> = {
  Haru: {
    Idle: [
      "motions/haru_g_idle.motion3.json",
      "motions/haru_g_m15.motion3.json",
    ],
    TapBody: [
      "motions/haru_g_m26.motion3.json",
      "motions/haru_g_m06.motion3.json",
      "motions/haru_g_m20.motion3.json",
      "motions/haru_g_m09.motion3.json",
    ],
  },
  Mao: {
    Idle: ["motions/mtn_01.motion3.json", "motions/sample_01.motion3.json"],
    TapBody: [
      "motions/mtn_02.motion3.json",
      "motions/mtn_03.motion3.json",
      "motions/mtn_04.motion3.json",
      "motions/special_01.motion3.json",
      "motions/special_02.motion3.json",
      "motions/special_03.motion3.json",
    ],
  },
};

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

describe("motion descriptions", () => {
  const documented = CHARACTER_IDS.filter(
    (id) => CHARACTER_CONFIGS[id].live2d.motionDescriptions !== undefined,
  );

  it("covers the characters whose motions were watched", () => {
    expect(documented.sort()).toEqual(["Haru", "Mao"]);
  });

  for (const id of documented) {
    it(`${id}: motion files are still in the observed order`, () => {
      const { modelPath } = CHARACTER_CONFIGS[id].live2d;
      expect(readModelMotionFiles(modelPath)).toEqual(
        EXPECTED_MOTION_FILES[id],
      );
    });

    it(`${id}: every group is described, one entry per motion`, () => {
      const { motionDescriptions } = CHARACTER_CONFIGS[id].live2d;
      const pinned = EXPECTED_MOTION_FILES[id]!;

      // Equality, not inclusion: a partial or empty motionDescriptions would
      // otherwise satisfy a per-group loop vacuously.
      expect(Object.keys(motionDescriptions ?? {}).sort()).toEqual(
        Object.keys(pinned).sort(),
      );

      for (const [group, files] of Object.entries(pinned)) {
        const entries = motionDescriptions?.[group] ?? [];
        expect(entries).toHaveLength(files.length);
        for (const entry of entries) {
          expect(typeof entry).toBe("string");
          expect(entry.trim().length).toBeGreaterThan(0);
        }
      }
    });
  }
});
