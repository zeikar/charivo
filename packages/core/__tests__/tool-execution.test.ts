import { describe, expect, it, vi } from "vitest";
import {
  createToolFailureOutput,
  createToolRegistry,
  serializeToolResult,
  withToolTimeout,
  type ToolRegistration,
} from "@charivo/core";

function createRegistration(name: string): ToolRegistration {
  return {
    definition: {
      type: "function",
      name,
      description: `Run ${name}.`,
      parameters: {
        type: "object",
        properties: {
          mood: { type: "string", enum: ["happy", "calm"] },
          nested: { type: "object", properties: { depth: { type: "number" } } },
        },
        required: ["mood"],
      },
    },
    handler: async () => ({ success: true }),
  };
}

describe("createToolRegistry", () => {
  it("registers, reads, counts, and unregisters tools", () => {
    const registry = createToolRegistry();
    const tool = createRegistration("setMood");

    expect(registry.size()).toBe(0);
    expect(registry.get("setMood")).toBeUndefined();

    registry.register(tool);
    expect(registry.size()).toBe(1);
    expect(registry.get("setMood")).toBe(tool);

    registry.unregister("setMood");
    expect(registry.size()).toBe(0);
    expect(registry.get("setMood")).toBeUndefined();
  });

  it("replaces a registration that reuses a tool name", () => {
    const registry = createToolRegistry();
    const replacement = createRegistration("setMood");

    registry.register(createRegistration("setMood"));
    registry.register(replacement);

    expect(registry.size()).toBe(1);
    expect(registry.get("setMood")).toBe(replacement);
  });

  it("returns definitions that do not alias the registered schema", () => {
    const registry = createToolRegistry();
    const tool = createRegistration("setMood");
    registry.register(tool);

    const [definition] = registry.getDefinitions();
    definition.parameters.properties.mood = { type: "number" };
    definition.parameters.required?.push("injected");

    expect(tool.definition.parameters.properties.mood).toEqual({
      type: "string",
      enum: ["happy", "calm"],
    });
    expect(tool.definition.parameters.required).toEqual(["mood"]);
  });

  it("copies nested schemas deeply, not just the top-level containers", () => {
    const registry = createToolRegistry();
    const tool = createRegistration("setMood");
    registry.register(tool);

    const [definition] = registry.getDefinitions();
    const mood = definition.parameters.properties.mood as {
      enum: string[];
    };
    const nested = definition.parameters.properties.nested as {
      properties: Record<string, unknown>;
    };
    mood.enum.push("furious");
    nested.properties.injected = { type: "string" };

    expect(tool.definition.parameters.properties.mood).toEqual({
      type: "string",
      enum: ["happy", "calm"],
    });
    expect(tool.definition.parameters.properties.nested).toEqual({
      type: "object",
      properties: { depth: { type: "number" } },
    });
  });
});

describe("withToolTimeout", () => {
  it("rejects with a labeled message when the handler exceeds the timeout", async () => {
    await expect(
      withToolTimeout(new Promise(() => undefined), 5, "setMood", "LLM tool"),
    ).rejects.toThrow('LLM tool "setMood" timed out after 5ms');
  });

  it("defaults the label when a caller omits it", async () => {
    await expect(
      withToolTimeout(new Promise(() => undefined), 5, "setMood"),
    ).rejects.toThrow('Tool "setMood" timed out after 5ms');
  });

  it("resolves and clears the timer when the handler wins", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(
      withToolTimeout(Promise.resolve("done"), 5_000, "setMood", "LLM tool"),
    ).resolves.toBe("done");
    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });
});

describe("serializeToolResult", () => {
  it("returns the JSON string for a serializable result", () => {
    expect(serializeToolResult({ success: true }, "setMood")).toBe(
      '{"success":true}',
    );
  });

  it("throws when toJSON yields undefined instead of dropping the payload", () => {
    expect(() =>
      serializeToolResult(
        { success: true, toJSON: () => undefined },
        "setMood",
        "Realtime tool",
      ),
    ).toThrow('Realtime tool "setMood" result could not be serialized to JSON');
  });

  it("propagates the error for a circular result", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => serializeToolResult(circular, "setMood")).toThrow();
  });
});

describe("createToolFailureOutput", () => {
  it("produces a serializable output carrying the error message", () => {
    const output = createToolFailureOutput(new Error("handler exploded"));

    expect(output).toEqual({ success: false, error: "handler exploded" });
    expect(serializeToolResult(output, "setMood")).toBe(
      '{"success":false,"error":"handler exploded"}',
    );
  });
});
