import type { ToolDefinition, ToolRegistration } from "@charivo/core";

export class RealtimeToolRegistry {
  private readonly tools = new Map<string, ToolRegistration>();

  register(tool: ToolRegistration): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values(), (tool) => ({
      ...tool.definition,
      parameters: {
        ...tool.definition.parameters,
        properties: { ...tool.definition.parameters.properties },
        required: tool.definition.parameters.required
          ? [...tool.definition.parameters.required]
          : undefined,
      },
    }));
  }
}
