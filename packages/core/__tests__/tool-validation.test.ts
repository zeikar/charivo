import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/types";
import {
  assertToolResultObject,
  validateToolArguments,
} from "../src/tool-validation";

const baseTool: ToolDefinition = {
  type: "function",
  name: "setAmount",
  description: "Set an amount.",
  parameters: {
    type: "object",
    properties: {
      amount: {
        type: "number",
      },
    },
    required: ["amount"],
  },
};

describe("validateToolArguments", () => {
  it("accepts arguments that match the schema", () => {
    expect(() => {
      validateToolArguments(baseTool, { amount: 1.5 });
    }).not.toThrow();
  });

  it("uses the neutral tool label by default", () => {
    expect(() => {
      validateToolArguments(baseTool, {});
    }).toThrow(
      'Tool "setAmount" arguments failed schema validation: missing required property "amount"',
    );
  });

  it("passes a custom tool label through to messages", () => {
    expect(() => {
      validateToolArguments(baseTool, { amount: "1" }, "Realtime tool");
    }).toThrow(
      'Realtime tool "setAmount" arguments failed schema validation: property "amount" must be number',
    );
  });

  it("rejects non-object arguments under the default label", () => {
    expect(() => {
      validateToolArguments(baseTool, "not-an-object");
    }).toThrow(
      'Tool "setAmount" arguments failed schema validation: arguments must be an object',
    );
  });

  it("rejects enum mismatches under the default label", () => {
    const enumTool: ToolDefinition = {
      type: "function",
      name: "setMode",
      description: "Set a mode.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["fast", "slow"],
          },
        },
        required: ["mode"],
      },
    };

    expect(() => {
      validateToolArguments(enumTool, { mode: "medium" });
    }).toThrow(
      'Tool "setMode" arguments failed schema validation: property "mode" must be one of "fast", "slow"',
    );
  });
});

describe("assertToolResultObject", () => {
  it("accepts plain objects", () => {
    expect(() => {
      assertToolResultObject({ success: true }, "setAmount");
    }).not.toThrow();
  });

  it("rejects arrays, null, and primitives", () => {
    for (const result of [[], null, "done", 1, undefined]) {
      expect(() => {
        assertToolResultObject(result, "setAmount");
      }).toThrow('Tool "setAmount" must return an object');
    }
  });

  it("passes a custom tool label through to messages", () => {
    expect(() => {
      assertToolResultObject([], "setAmount", "Realtime tool");
    }).toThrow('Realtime tool "setAmount" must return an object');
  });
});
