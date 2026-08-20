import { describe, expect, it, vi } from "vitest";
import type { EventMap, ToolDefinition } from "@charivo/core";
import {
  AVATAR_CONTROL_TOOL_NAMES,
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
  SET_EXPRESSION_TOOL_NAME,
} from "@charivo/avatar";

/** Reads one generated property schema out of the untyped `properties` bag. */
function propertySchema(
  definition: ToolDefinition,
  property: string,
): { description?: string; enum?: unknown[] } {
  return definition.parameters.properties[property] as {
    description?: string;
    enum?: unknown[];
  };
}

const TOOL_CONTEXT = {
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
    audioPlaying: false,
    lastError: null,
  },
};

describe("avatar", () => {
  it("builds avatar-specific realtime instructions only when avatar tools are in use", () => {
    const instructions = buildAvatarControlInstructions({
      expressions: ["Smile"],
      motions: {
        Idle: 2,
      },
    });

    expect(instructions).toContain(
      "Use avatar tools only when they make the moment feel present.",
    );
    expect(instructions).toContain("Use lookAt when your attention shifts");
    expect(instructions).toContain(
      "Use setExpression with a fitting expression before you speak",
    );
    expect(instructions).toContain("Use playMotion for bigger beats");
    expect(instructions).toContain(
      "Richer beats can combine two avatar actions",
    );
    expect(instructions).not.toMatch(/\b(at most one|one action|single)\b/);

    const gazeOnlyInstructions = buildAvatarControlInstructions({
      expressions: [],
      motions: {},
    });

    expect(gazeOnlyInstructions).toContain(
      "Use avatar tools only when they make the moment feel present.",
    );
    expect(gazeOnlyInstructions).toContain(
      "Use lookAt when your attention shifts",
    );
    expect(gazeOnlyInstructions).not.toContain("setExpression");
    expect(gazeOnlyInstructions).not.toContain("playMotion");
    expect(gazeOnlyInstructions).not.toContain(
      "Richer beats can combine two avatar actions",
    );
  });

  it("includes expression meanings in setExpression description and instructions when descriptions are provided", () => {
    const catalog = {
      expressions: ["F01", "F02"],
      expressionDescriptions: {
        F01: "soft gentle smile",
        F02: "wide happy grin",
      },
      motions: {},
    };

    const tools = createAvatarControlTools(catalog);
    const expressionIdDescription = propertySchema(
      tools[0]!.definition,
      "expressionId",
    ).description;

    expect(expressionIdDescription).toContain("F01 = soft gentle smile");
    expect(expressionIdDescription).toContain("F02 = wide happy grin");

    const instructions = buildAvatarControlInstructions(catalog);
    expect(instructions).toContain("F01 = soft gentle smile");
    expect(instructions).toContain("F02 = wide happy grin");
  });

  it("orders meanings by catalog.expressions order, not by expressionDescriptions key order", () => {
    const catalog = {
      expressions: ["F01", "F02"],
      expressionDescriptions: {
        // Declared in reverse of `expressions` order on purpose.
        F02: "wide happy grin",
        F01: "soft gentle smile",
      },
      motions: {},
    };

    const tools = createAvatarControlTools(catalog);
    const expressionIdDescription = propertySchema(
      tools[0]!.definition,
      "expressionId",
    ).description;

    expect(expressionIdDescription).toContain(
      "F01 = soft gentle smile; F02 = wide happy grin",
    );

    const instructions = buildAvatarControlInstructions(catalog);
    expect(instructions).toContain(
      "F01 = soft gentle smile; F02 = wide happy grin",
    );
  });

  it("matches today's exact expressionId description and instructions when no descriptions are provided", () => {
    const catalog = {
      expressions: ["Smile"],
      motions: {},
    };

    const tools = createAvatarControlTools(catalog);
    const expressionIdDescription = propertySchema(
      tools[0]!.definition,
      "expressionId",
    ).description;

    expect(expressionIdDescription).toBe(
      "Expression ID available for your current model.",
    );

    const instructions = buildAvatarControlInstructions(catalog);
    expect(instructions).toBe(
      [
        "Use avatar tools only when they make the moment feel present. Quiet exchanges can pass without an avatar action.",
        "Use lookAt when your attention shifts or a small gaze reaction is enough.",
        "React with your face when feelings come up: greetings, gratitude, jokes, teasing, concern, reassurance, surprise, or sympathy. Use setExpression with a fitting expression before you speak, even when the user did not ask for it.",
      ].join("\n"),
    );
  });

  it("ignores description keys not present in expressions, matching the no-descriptions output when nothing survives the intersection", () => {
    const catalogWithoutDescriptions = {
      expressions: ["Smile"],
      motions: {},
    };
    const catalogWithUnmatchedDescriptions = {
      expressions: ["Smile"],
      expressionDescriptions: {
        Unrelated: "does not exist in expressions",
      },
      motions: {},
    };

    const toolsWithoutDescriptions = createAvatarControlTools(
      catalogWithoutDescriptions,
    );
    const toolsWithUnmatchedDescriptions = createAvatarControlTools(
      catalogWithUnmatchedDescriptions,
    );

    expect(
      propertySchema(
        toolsWithUnmatchedDescriptions[0]!.definition,
        "expressionId",
      ).description,
    ).toBe(
      propertySchema(toolsWithoutDescriptions[0]!.definition, "expressionId")
        .description,
    );

    expect(
      buildAvatarControlInstructions(catalogWithUnmatchedDescriptions),
    ).toBe(buildAvatarControlInstructions(catalogWithoutDescriptions));

    const catalogWithPartialMatch = {
      expressions: ["Smile", "Frown"],
      expressionDescriptions: {
        Smile: "happy face",
        Unrelated: "does not exist in expressions",
      },
      motions: {},
    };

    const toolsWithPartialMatch = createAvatarControlTools(
      catalogWithPartialMatch,
    );
    const partialDescription = propertySchema(
      toolsWithPartialMatch[0]!.definition,
      "expressionId",
    ).description;

    expect(partialDescription).toContain("Smile = happy face");
    expect(partialDescription).not.toContain("Unrelated");

    const partialInstructions = buildAvatarControlInstructions(
      catalogWithPartialMatch,
    );
    expect(partialInstructions).toContain("Smile = happy face");
    expect(partialInstructions).not.toContain("Unrelated");
  });

  it("omits everything expression-related, including any meanings line, for zero-expression catalogs", () => {
    const catalog = {
      expressions: [],
      expressionDescriptions: {
        F01: "soft gentle smile",
      },
      motions: {},
    };

    const tools = createAvatarControlTools(catalog);
    expect(
      tools.some((tool) => tool.definition.name === SET_EXPRESSION_TOOL_NAME),
    ).toBe(false);

    const instructions = buildAvatarControlInstructions(catalog);
    expect(instructions).not.toContain("setExpression");
    expect(instructions).not.toContain("meanings");
    expect(instructions).not.toContain("F01");
  });

  it("creates avatar control tools with the expected names and validation", async () => {
    const tools = createAvatarControlTools({
      expressions: ["Smile"],
      motions: {
        Idle: 2,
      },
    });

    expect(AVATAR_CONTROL_TOOL_NAMES).toEqual([
      "setExpression",
      "playMotion",
      "lookAt",
    ]);
    expect(tools.map((tool) => tool.definition.name)).toEqual(
      AVATAR_CONTROL_TOOL_NAMES,
    );

    await expect(
      tools[0]!.handler({ expressionId: "Missing" }, TOOL_CONTEXT),
    ).rejects.toThrow('setExpression requires a valid "expressionId"');

    await expect(
      tools[1]!.handler({ group: "Idle", index: 99 }, TOOL_CONTEXT),
    ).rejects.toThrow('playMotion index 99 is out of range for group "Idle"');

    await expect(
      tools[2]!.handler({ x: 4, y: -4 }, TOOL_CONTEXT),
    ).resolves.toEqual({
      success: true,
      x: 1,
      y: -1,
    });
  });

  it("projects avatar tool results into core realtime events", () => {
    const projector = createAvatarResultProjector();
    const emit =
      vi.fn<
        <K extends keyof EventMap>(event: K, payload: EventMap[K]) => void
      >();

    projector({
      name: "setExpression",
      output: { success: true, expressionId: "Smile" },
      callId: "call-expression",
      emit,
    });
    projector({
      name: "playMotion",
      output: { success: true, group: "Idle", index: 0 },
      callId: "call-motion",
      emit,
    });
    projector({
      name: "lookAt",
      output: { success: true, x: 0.2, y: -0.3 },
      callId: "call-gaze",
      emit,
    });
    projector({
      name: "describeScene",
      output: { success: true },
      callId: "call-ignore",
      emit,
    });

    expect(emit.mock.calls).toEqual([
      ["avatar:expression", { expressionId: "Smile" }],
      ["avatar:motion", { group: "Idle", index: 0 }],
      ["avatar:gaze", { x: 0.2, y: -0.3 }],
    ]);
  });
});
