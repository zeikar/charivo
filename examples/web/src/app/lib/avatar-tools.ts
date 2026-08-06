import type { AvatarControlCatalog, ToolRegistration } from "@charivo/core";
import {
  AVATAR_CONTROL_TOOL_NAMES,
  createAvatarControlTools,
} from "@charivo/avatar";

const describeCharacterProfileTool: ToolRegistration = {
  definition: {
    type: "function",
    name: "describeCharacterProfile",
    description: "Return the active character profile for grounding.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async handler(_args, context) {
    return {
      success: true,
      characterId: context.character?.id ?? null,
      name: context.character?.name ?? null,
      personality: context.character?.personality ?? null,
    };
  },
};

export function buildDemoRealtimeTools(
  catalog: AvatarControlCatalog,
): ToolRegistration[] {
  return [...createAvatarControlTools(catalog), describeCharacterProfileTool];
}

interface AvatarToolHost {
  registerTool?(tool: ToolRegistration): void;
  unregisterTool?(name: string): void;
}

export function syncAvatarControlTools(
  target: AvatarToolHost,
  catalog: AvatarControlCatalog,
): void {
  for (const toolName of AVATAR_CONTROL_TOOL_NAMES) {
    target.unregisterTool?.(toolName);
  }

  for (const tool of createAvatarControlTools(catalog)) {
    target.registerTool?.(tool);
  }
}
