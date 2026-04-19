import type {
  AvatarControlCatalog,
  RealtimeManager,
  RealtimeToolRegistration,
} from "@charivo/core";
import {
  AVATAR_CONTROL_TOOL_NAMES,
  createAvatarControlTools,
} from "@charivo/realtime";

const describeCharacterProfileTool: RealtimeToolRegistration = {
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
): RealtimeToolRegistration[] {
  return [...createAvatarControlTools(catalog), describeCharacterProfileTool];
}

export function syncAvatarControlTools(
  manager: RealtimeManager,
  catalog: AvatarControlCatalog,
): void {
  for (const toolName of AVATAR_CONTROL_TOOL_NAMES) {
    manager.unregisterTool(toolName);
  }

  for (const tool of createAvatarControlTools(catalog)) {
    manager.registerTool(tool);
  }
}
