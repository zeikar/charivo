import { describe, expect, it, vi } from "vitest";
import type { EventMap } from "@charivo/core";
import {
  AVATAR_CONTROL_TOOL_NAMES,
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
