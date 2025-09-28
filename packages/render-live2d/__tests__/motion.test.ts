import { describe, expect, it, vi } from "vitest";
import {
  animateExpression,
  inferMotionFromMessage,
  playMotion,
  playSafe,
} from "../src/utils/motion";

describe("motion utilities", () => {
  it("infers motion keywords", () => {
    expect(inferMotionFromMessage("안녕")).toBe("greeting");
    expect(inferMotionFromMessage("hello world")).toBe("greeting");
    expect(inferMotionFromMessage("좋아")).toBe("happy");
    expect(inferMotionFromMessage("어려워")).toBe("thinking");
    expect(inferMotionFromMessage("random")).toBe("talk");
  });

  it("guards motion playback", () => {
    const model = {
      motion: vi.fn(() => {
        throw new Error("boom");
      }),
    } as unknown as Parameters<typeof playSafe>[0];

    expect(() => playSafe(model, "Idle")).not.toThrow();
  });

  it("plays motions with expected groups", () => {
    const motionSpy = vi.fn();
    const model = {
      motion: motionSpy,
    } as unknown as Parameters<typeof playMotion>[0];

    playMotion(model, "greeting");
    expect(motionSpy).toHaveBeenCalledWith("Tap@Body", 0, 1);
    expect(motionSpy).toHaveBeenCalledWith("Tap", 0, 1);

    motionSpy.mockClear();
    playMotion(model, "happy");
    expect(motionSpy).toHaveBeenCalledWith("Flick", 0, 1);

    motionSpy.mockClear();
    playMotion(model, "thinking");
    expect(motionSpy).toHaveBeenCalledWith("Idle", 1, 1);

    motionSpy.mockClear();
    playMotion(model, "talk");
    expect(motionSpy).toHaveBeenCalledWith("Idle", 0, 1);
  });

  it("animates expressions based on motion", () => {
    const expressionSpy = vi.fn();
    const model = {
      expression: expressionSpy,
    } as unknown as Parameters<typeof animateExpression>[0];

    animateExpression(model, "greeting");
    animateExpression(model, "happy");
    animateExpression(model, "thinking");
    animateExpression(model, "talk");

    expect(expressionSpy).toHaveBeenCalledWith("smile");
    expect(expressionSpy).toHaveBeenCalledWith("surprised");
    expect(expressionSpy).toHaveBeenCalledWith("normal");
  });
});
