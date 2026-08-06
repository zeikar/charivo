import {
  validateToolArguments as validateToolArgumentsWithLabel,
  type ToolDefinition,
} from "@charivo/core";

export function validateToolArguments(
  definition: ToolDefinition,
  args: unknown,
): void {
  validateToolArgumentsWithLabel(definition, args, "Realtime tool");
}
