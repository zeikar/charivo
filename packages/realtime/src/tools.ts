import {
  type AvatarControlCatalog,
  type GazeCoordinates,
  type MotionSelection,
  type RealtimeToolRegistration,
} from "@charivo/core";
import {
  LOOK_AT_TOOL_DESCRIPTION,
  PLAY_MOTION_TOOL_DESCRIPTION,
  SET_EXPRESSION_TOOL_DESCRIPTION,
} from "./instructions";

const MIN_GAZE = -1;
const MAX_GAZE = 1;

export const SET_EXPRESSION_TOOL_NAME = "setExpression";
export const PLAY_MOTION_TOOL_NAME = "playMotion";
export const LOOK_AT_TOOL_NAME = "lookAt";

export const AVATAR_CONTROL_TOOL_NAMES = [
  SET_EXPRESSION_TOOL_NAME,
  PLAY_MOTION_TOOL_NAME,
  LOOK_AT_TOOL_NAME,
] as const;

export interface ExpressionArgs {
  expressionId: string;
}

export type MotionArgs = MotionSelection;

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
              description: "Expression ID from the loaded Live2D model.",
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
              description: "Motion group from the loaded Live2D model.",
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
