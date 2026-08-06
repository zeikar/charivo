import type { ToolDefinition, ToolRegistration } from "@charivo/core";

/**
 * Tool registry for LLM sessions.
 *
 * Mirrors the realtime registry but stays local to this package so `@charivo/llm`
 * keeps depending only on `@charivo/core`.
 */
export class LLMToolRegistry {
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

  size(): number {
    return this.tools.size;
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

/** Always-serializable output handed back to the model when a tool call fails. */
export function createFailureOutput(error: Error): Record<string, unknown> {
  return {
    success: false,
    error: error.message,
  };
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(`LLM tool "${toolName}" timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
