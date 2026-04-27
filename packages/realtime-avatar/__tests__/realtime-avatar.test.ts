import { describe, expect, it, vi } from "vitest";
import type { EventMap } from "@charivo/core";
import {
  AVATAR_CONTROL_TOOL_NAMES,
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/realtime-avatar";

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
    lastError: null,
  },
};

describe("realtime-avatar", () => {
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
      ["realtime:expression", { expressionId: "Smile" }],
      ["realtime:motion", { group: "Idle", index: 0 }],
      ["realtime:gaze", { x: 0.2, y: -0.3 }],
    ]);
  });
});
