import { describe, expect, it } from "vitest";
import { buildDemoRealtimeInstructions } from "./realtime-instructions";

describe("buildDemoRealtimeInstructions", () => {
  it("appends demo guidance on top of library-generated character instructions", () => {
    const instructions = buildDemoRealtimeInstructions(
      {
        id: "char-1",
        name: "Hiyori",
        description: "A thoughtful and gentle character with a calm demeanor",
        personality: "Soft-spoken, empathetic, and caring",
      },
      {
        expressions: ["Smile"],
        motions: {},
      },
    );

    expect(instructions).toMatch(/^You are Hiyori\./);
    expect(instructions).toContain(
      "A thoughtful and gentle character with a calm demeanor.",
    );
    expect(instructions).toContain(
      "Your personality is Soft-spoken, empathetic, and caring.",
    );
    expect(instructions).toContain(
      "Never break character. Never refer to yourself as an AI, model, or assistant.",
    );
    expect(instructions).toContain(
      "Keep replies short and natural for a live voice demo.",
    );
    expect(instructions).toContain(
      "call setExpression with a fitting expression before your spoken reply",
    );
  });
});
