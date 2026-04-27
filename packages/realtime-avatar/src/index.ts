import type {
  AvatarControlCatalog,
  GazeCoordinates,
  RealtimeToolRegistration,
} from "@charivo/core";
import type { RealtimeToolResultProjector } from "@charivo/realtime";

const MIN_GAZE = -1;
const MAX_GAZE = 1;

const SET_EXPRESSION_TOOL_DESCRIPTION =
  "Change facial expression when emotion should show. Use proactively for greetings, gratitude, jokes, delight, surprise, concern, sympathy, embarrassment, frustration, tension, relief, or a warmer tone. Rich moments can pair setExpression with motion or gaze.";

const PLAY_MOTION_TOOL_DESCRIPTION =
  "Use a noticeable body motion for greetings, emphasis, or bigger reactions. Save this for moments that truly need body movement, and don't stack body motions in the same reply.";

const LOOK_AT_TOOL_DESCRIPTION =
  'Shift gaze for attention changes or focus. Trigger this on phrases like "glance", "look over", "peek at", or directional cues. A gaze shift can stand alone or pair with another avatar action when both fit.';

export const SET_EXPRESSION_TOOL_NAME = "setExpression";
export const PLAY_MOTION_TOOL_NAME = "playMotion";
export const LOOK_AT_TOOL_NAME = "lookAt";

export const AVATAR_CONTROL_TOOL_NAMES = [
  SET_EXPRESSION_TOOL_NAME,
  PLAY_MOTION_TOOL_NAME,
  LOOK_AT_TOOL_NAME,
] as const;

export function buildAvatarControlInstructions(
  catalog: AvatarControlCatalog,
): string {
  const hasExpressions = catalog.expressions.length > 0;
  const hasMotions = Object.keys(catalog.motions).length > 0;
  const instructions = [
    "Use avatar tools only when they make the moment feel present. Quiet exchanges can pass without an avatar action.",
    "Use lookAt when your attention shifts or a small gaze reaction is enough.",
  ];

  if (hasExpressions) {
    instructions.push(
      "React with your face when feelings come up: greetings, gratitude, jokes, teasing, concern, reassurance, surprise, or sympathy. Use setExpression with a fitting expression before you speak, even when the user did not ask for it.",
    );
  }

  if (hasMotions) {
    instructions.push(
      "Use playMotion for bigger beats such as greetings, emphasis, or strong reactions. Don't stack body motions in one reply.",
    );
  }

  if (hasExpressions && hasMotions) {
    instructions.push(
      "Richer beats can combine two avatar actions, such as setExpression plus playMotion, when both earn their place.",
    );
  }

  return instructions.join("\n");
}

export interface ExpressionArgs {
  expressionId: string;
}

export interface MotionArgs {
  group: string;
  index: number;
}

export type LookAtArgs = GazeCoordinates;

export function createAvatarControlTools(
  catalog: AvatarControlCatalog,
): RealtimeToolRegistration[] {
  const tools: RealtimeToolRegistration[] = [];

  if (catalog.expressions.length > 0) {
    const expressionValues = [...catalog.expressions];
    tools.push({
      definition: {
        type: "function",
        name: SET_EXPRESSION_TOOL_NAME,
        description: SET_EXPRESSION_TOOL_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            expressionId: {
              type: "string",
              description: "Expression ID available for your current model.",
              enum: expressionValues,
            },
          },
          required: ["expressionId"],
        },
      },
      async handler(args) {
        const expressionId = args.expressionId;
        if (
          typeof expressionId !== "string" ||
          !expressionValues.includes(expressionId)
        ) {
          throw new Error(
            'setExpression requires a valid "expressionId" from the model catalog',
          );
        }

        return {
          success: true,
          expressionId,
        };
      },
    });
  }

  const motionGroups = Object.keys(catalog.motions);
  if (motionGroups.length > 0) {
    tools.push({
      definition: {
        type: "function",
        name: PLAY_MOTION_TOOL_NAME,
        description: PLAY_MOTION_TOOL_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            group: {
              type: "string",
              description: "Motion group available for your current model.",
              enum: motionGroups,
            },
            index: {
              type: "number",
              description:
                "Zero-based motion index within the selected motion group.",
            },
          },
          required: ["group", "index"],
        },
      },
      async handler(args) {
        const group = args.group;
        const index = args.index;

        if (typeof group !== "string" || !motionGroups.includes(group)) {
          throw new Error(
            'playMotion requires a valid "group" from the model catalog',
          );
        }

        if (!Number.isInteger(index)) {
          throw new Error('playMotion requires an integer "index"');
        }

        const count = catalog.motions[group] ?? 0;
        const motionIndex = index as number;

        if (motionIndex < 0 || motionIndex >= count) {
          throw new Error(
            `playMotion index ${String(motionIndex)} is out of range for group "${group}"`,
          );
        }

        return {
          success: true,
          group,
          index: motionIndex,
        };
      },
    });
  }

  tools.push({
    definition: {
      type: "function",
      name: LOOK_AT_TOOL_NAME,
      description: LOOK_AT_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          x: {
            type: "number",
            description:
              "Normalized horizontal gaze target. -1 looks left, 0 is center, 1 looks right.",
          },
          y: {
            type: "number",
            description:
              "Normalized vertical gaze target. -1 looks down, 0 is center, 1 looks up.",
          },
        },
        required: ["x", "y"],
      },
    },
    async handler(args) {
      const x = args.x;
      const y = args.y;

      if (typeof x !== "number" || Number.isNaN(x)) {
        throw new Error('lookAt requires a numeric "x"');
      }

      if (typeof y !== "number" || Number.isNaN(y)) {
        throw new Error('lookAt requires a numeric "y"');
      }

      return {
        success: true,
        x: clamp(x, MIN_GAZE, MAX_GAZE),
        y: clamp(y, MIN_GAZE, MAX_GAZE),
      };
    },
  });

  return tools;
}

export function createAvatarResultProjector(): RealtimeToolResultProjector {
  return ({ name, output, emit }) => {
    switch (name) {
      case SET_EXPRESSION_TOOL_NAME: {
        const expressionId = output.expressionId;
        if (typeof expressionId === "string") {
          emit("realtime:expression", { expressionId });
        }
        return;
      }

      case PLAY_MOTION_TOOL_NAME: {
        const group = output.group;
        const index = output.index;
        if (typeof group === "string" && Number.isInteger(index)) {
          emit("realtime:motion", { group, index: index as number });
        }
        return;
      }

      case LOOK_AT_TOOL_NAME: {
        const coords = readGazeCoordinates(output);
        if (coords) {
          emit("realtime:gaze", coords);
        }
      }
    }
  };
}

function readGazeCoordinates(
  output: Record<string, unknown>,
): GazeCoordinates | null {
  const x = output.x;
  const y = output.y;

  if (typeof x !== "number" || typeof y !== "number") {
    return null;
  }

  return { x, y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
