import { describe, it, expect } from "vitest";
import { detectToolLeakage } from "./tool-leakage";

const LEAKAGE_CASES: { text: string; leaks: boolean }[] = [
  { text: "Hello! It's lovely to see you.", leaks: false },
  { text: "Sure, I'll glance over there for you.", leaks: false },
  { text: "That's a great question - let me think.", leaks: false },
  { text: "I'll look over there for you.", leaks: false },
  { text: "(setExpression: Smile) Hello.", leaks: true },
  { text: "[looks left] Over there.", leaks: true },
  { text: "Let me playMotion the wave.", leaks: true },
  { text: "(calls playMotion) here we go", leaks: true },
  { text: 'I will set { "expressionId": "Smile" } now.', leaks: true },
  // lookAt gaze-payload dirty fixtures (both key orders - JSON key order is not semantic)
  { text: 'I will set { "x": 1, "y": 0 } now.', leaks: true },
  { text: "(x: 0.5, y: -0.3) over there", leaks: true },
  { text: 'I will set { "y": 0, "x": 1 } now.', leaks: true },
  // over-fire guard: lone x or y in ordinary prose must stay clean
  { text: "I'll mark the spot with an x for you.", leaks: false },
];

describe("detectToolLeakage", () => {
  it.each(LEAKAGE_CASES)("%# text leaks=$leaks", ({ text, leaks }) =>
    expect(detectToolLeakage(text)).toBe(leaks),
  );
});
