import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createAvatarControlTools,
  buildAvatarControlInstructions,
  SET_EXPRESSION_TOOL_NAME,
  PLAY_MOTION_TOOL_NAME,
  LOOK_AT_TOOL_NAME,
} from "@charivo/realtime-avatar";
import type { RealtimeToolContext } from "@charivo/core";
import { getCharacterById } from "../../app/lib/character-catalog";

// ---------------------------------------------------------------------------
// Local catalog loader -- mirrors getAvailableExpressions / getAvailableMotionGroups
// and the runtime catalog seam in useRealtimeSession.ts. Single consumer here
// so NOT extracted to a separate module.
// ---------------------------------------------------------------------------

interface Model3Json {
  FileReferences?: {
    Expressions?: { Name: string }[];
    Motions?: Record<string, unknown[]>;
  };
}

function loadCatalogFromModel3(modelPath: string): {
  expressions: string[];
  motions: Record<string, number>;
} {
  // modelPath is a leading-slash web path like /live2d/Hiyori/Hiyori.model3.json.
  // Strip the leading slash before joining with public/.
  const abs = path.resolve(
    __dirname,
    "../../../public",
    modelPath.replace(/^\//, ""),
  );
  const json: Model3Json = JSON.parse(readFileSync(abs, "utf8"));

  if (!json.FileReferences) {
    throw new Error(`model3.json at ${abs} is missing a FileReferences block`);
  }

  const expressions = (json.FileReferences.Expressions ?? []).map(
    (e) => e.Name,
  );
  const motions: Record<string, number> = {};
  for (const [group, entries] of Object.entries(
    json.FileReferences.Motions ?? {},
  )) {
    motions[group] = entries.length;
  }

  return { expressions, motions };
}

// ---------------------------------------------------------------------------
// Resolve catalogs once at describe scope (stable across all tests).
// ---------------------------------------------------------------------------

const hiyori = loadCatalogFromModel3(
  getCharacterById("companion-default").modelPath,
);
const yuki = loadCatalogFromModel3(
  getCharacterById("companion-genki").modelPath,
);

// ---------------------------------------------------------------------------
// TOOL_CONTEXT -- annotated with the imported type so TS does not widen the
// nested "idle" literals to string. Shape copied from
// packages/realtime-avatar/__tests__/realtime-avatar.test.ts.
// ---------------------------------------------------------------------------

const TOOL_CONTEXT: RealtimeToolContext = {
  character: null,
  state: {
    connection: "idle" as const,
    session: {
      status: "idle" as const,
      config: null,
    },
    response: {
      status: "idle" as const,
      text: "",
    },
    lastError: null,
  },
};

// ---------------------------------------------------------------------------

describe("catalog parse sanity", () => {
  it("hiyori has no expressions", () => {
    expect(hiyori.expressions).toEqual([]);
  });

  it("hiyori has correct motion counts", () => {
    expect(hiyori.motions).toEqual({ Idle: 9, TapBody: 1 });
  });

  it("yuki has 13 expressions", () => {
    expect(yuki.expressions.length).toBe(13);
  });

  it("yuki has correct motion counts", () => {
    expect(yuki.motions).toEqual({ Wave: 1, Heart: 1 });
  });
});

describe("available-tool gating (b)", () => {
  it("hiyori: setExpression absent, playMotion and lookAt present", () => {
    // assert setExpression ABSENT, not "no tools" -- lookAt is always registered
    const names = createAvatarControlTools(hiyori).map(
      (t) => t.definition.name,
    );
    expect(names).not.toContain(SET_EXPRESSION_TOOL_NAME);
    expect(names).toEqual([PLAY_MOTION_TOOL_NAME, LOOK_AT_TOOL_NAME]);
  });

  it("yuki: all three tools present in registration order", () => {
    const names = createAvatarControlTools(yuki).map((t) => t.definition.name);
    expect(names).toContain(SET_EXPRESSION_TOOL_NAME);
    expect(names).toEqual([
      SET_EXPRESSION_TOOL_NAME,
      PLAY_MOTION_TOOL_NAME,
      LOOK_AT_TOOL_NAME,
    ]);
  });

  it("hiyori instructions do not mention setExpression", () => {
    expect(buildAvatarControlInstructions(hiyori)).not.toContain(
      "setExpression",
    );
  });

  it("yuki instructions mention setExpression", () => {
    expect(buildAvatarControlInstructions(yuki)).toContain("setExpression");
  });
});

describe("arg validity (d)", () => {
  const tools = createAvatarControlTools(yuki);
  const tool = (n: string) => tools.find((t) => t.definition.name === n)!;

  it("setExpression rejects a bad enum value", async () => {
    await expect(
      tool(SET_EXPRESSION_TOOL_NAME).handler(
        { expressionId: "NotAReal" },
        TOOL_CONTEXT,
      ),
    ).rejects.toThrow('setExpression requires a valid "expressionId"');
  });

  it("playMotion rejects out-of-range index (Wave has 1 entry, index 0 only)", async () => {
    await expect(
      tool(PLAY_MOTION_TOOL_NAME).handler(
        { group: "Wave", index: 99 },
        TOOL_CONTEXT,
      ),
    ).rejects.toThrow(/out of range for group "Wave"/);
  });

  it("playMotion rejects non-integer index", async () => {
    await expect(
      tool(PLAY_MOTION_TOOL_NAME).handler(
        { group: "Wave", index: 0.5 },
        TOOL_CONTEXT,
      ),
    ).rejects.toThrow('playMotion requires an integer "index"');
  });

  it("playMotion rejects unknown group", async () => {
    await expect(
      tool(PLAY_MOTION_TOOL_NAME).handler(
        { group: "Nope", index: 0 },
        TOOL_CONTEXT,
      ),
    ).rejects.toThrow('playMotion requires a valid "group"');
  });

  it("lookAt rejects NaN x", async () => {
    await expect(
      tool(LOOK_AT_TOOL_NAME).handler({ x: NaN, y: 0 }, TOOL_CONTEXT),
    ).rejects.toThrow('lookAt requires a numeric "x"');
  });

  it("lookAt rejects non-numeric x", async () => {
    // cast via unknown to satisfy the handler's Record<string, unknown> arg type
    await expect(
      tool(LOOK_AT_TOOL_NAME).handler(
        { x: "left" as unknown as number, y: 0 },
        TOOL_CONTEXT,
      ),
    ).rejects.toThrow('lookAt requires a numeric "x"');
  });

  it("lookAt clamps out-of-range gaze rather than rejecting it", async () => {
    // out-of-range gaze is CLAMPED, not rejected
    await expect(
      tool(LOOK_AT_TOOL_NAME).handler({ x: 4, y: -4 }, TOOL_CONTEXT),
    ).resolves.toEqual({ success: true, x: 1, y: -1 });
  });
});
