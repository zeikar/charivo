import type { RealtimeTool, RealtimeToolRegistration } from "@charivo/core";

export class RealtimeToolRegistry {
  private readonly tools = new Map<string, RealtimeToolRegistration>();

  register(tool: RealtimeToolRegistration): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RealtimeToolRegistration | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): RealtimeTool[] {
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
