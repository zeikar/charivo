import { describe, expect, it } from "vitest";
import type { RealtimeTool } from "@charivo/core";
import { validateToolArguments } from "../../src/internal/tool-args-validation";

const baseTool: RealtimeTool = {
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
  it("rejects top-level non-object arguments", () => {
    expect(() => {
      validateToolArguments(baseTool, []);
    }).toThrow(
      'Realtime tool "setAmount" arguments failed schema validation: arguments must be an object',
    );
  });

  it("rejects unsupported schema type strings", () => {
    expect(() => {
      validateToolArguments(
        {
          ...baseTool,
          parameters: {
            type: "object",
            properties: {
              amount: {
                type: "flot",
              },
            },
            required: ["amount"],
          },
        },
        { amount: 1 },
      );
    }).toThrow(
      'Realtime tool "setAmount" arguments failed schema validation: property "amount" uses unsupported schema type "flot"',
    );
  });
});
