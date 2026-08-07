/**
 * Shared tool-execution plumbing: the registry, timeout, failure-output, and
 * serialization behavior every modality's tool runner needs.
 *
 * Like the validators in `./tool-validation`, each helper takes a `toolLabel`
 * so callers can distinguish realtime tools from other modalities in thrown
 * messages. Errors are plain `Error` for the same reason given there.
 */
import type { ToolDefinition, ToolRegistration } from "./types";
import { assertToolResultObject } from "./tool-validation";

/** Registry of the tools a session may execute, keyed by definition name. */
export interface ToolRegistry {
  register(tool: ToolRegistration): void;
  unregister(name: string): void;
  get(name: string): ToolRegistration | undefined;
  size(): number;
  /** Deep-copied definitions, safe to hand to a provider without aliasing. */
  getDefinitions(): ToolDefinition[];
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolRegistration>();

  return {
    register(tool) {
      tools.set(tool.definition.name, tool);
    },

    unregister(name) {
      tools.delete(name);
    },

    get(name) {
      return tools.get(name);
    },

    size() {
      return tools.size;
    },

    getDefinitions() {
      // JSON round-trip rather than a spread: definitions are JSON
      // Schema-shaped and must survive serialization to reach a provider
      // anyway, and a shallow copy would leave nested schemas (an `enum`
      // array, a nested `properties` object) aliased into the registration.
      return Array.from(
        tools.values(),
        (tool) => JSON.parse(JSON.stringify(tool.definition)) as ToolDefinition,
      );
    },
  };
}

/** Always-serializable output handed back to the model when a tool call fails. */
export function createToolFailureOutput(error: Error): Record<string, unknown> {
  return {
    success: false,
    error: error.message,
  };
}

export async function withToolTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
  toolLabel = "Tool",
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${toolLabel} "${toolName}" timed out after ${timeoutMs}ms`,
            ),
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

/**
 * Serializes a tool result, throwing when it cannot be represented as JSON.
 *
 * Call this inside a tool runner's failure boundary so an unserializable
 * output degrades to a failure output instead of reaching the transport.
 * `JSON.stringify` is declared to return `string`, but it returns the value
 * `undefined` at runtime for inputs whose `toJSON()` yields `undefined` — a
 * case that throws nothing and would otherwise drop the payload silently, so
 * it is checked explicitly rather than relying on a thrown error.
 */
export function serializeToolResult(
  result: Record<string, unknown>,
  toolName: string,
  toolLabel = "Tool",
): string {
  const serialized: unknown = JSON.stringify(result);

  if (typeof serialized !== "string") {
    throw new Error(
      `${toolLabel} "${toolName}" result could not be serialized to JSON`,
    );
  }

  return serialized;
}

/** A tool result's JSON string plus the parsed value every consumer sees. */
export interface ToolResultSnapshot {
  /** Handed to the model's tool turn, or to the realtime transport. */
  serialized: string;
  /** Parsed form of `serialized` — what `tool:result` and projectors receive. */
  snapshot: Record<string, unknown>;
}

/**
 * Serializes a tool result once and returns both the string and its parsed
 * snapshot, so every consumer downstream of a tool runner sees the same JSON
 * shape regardless of modality.
 *
 * Call this inside a tool runner's failure boundary: a result that cannot be
 * represented as JSON throws here and degrades to a failure output instead of
 * reaching a transport or a projector. `serializeToolResult` proves the result
 * is representable, but a `toJSON()` can still yield null, an array, or a
 * primitive, so the parsed value is checked against the tool-result contract
 * rather than cast to it.
 */
export function snapshotToolResult(
  result: Record<string, unknown>,
  toolName: string,
  toolLabel = "Tool",
): ToolResultSnapshot {
  const serialized = serializeToolResult(result, toolName, toolLabel);
  const parsed: unknown = JSON.parse(serialized);

  assertToolResultObject(parsed, toolName, toolLabel);

  return { serialized, snapshot: parsed };
}
