import type { LAppModel } from "../cubism/lappmodel";
import * as LAppDefine from "../cubism/lappdefine";

export type MotionType = "greeting" | "happy" | "thinking" | "talk";

export function inferMotionFromMessage(text: string): MotionType {
  if (text.includes("안녕") || text.toLowerCase().includes("hello"))
    return "greeting";
  if (text.includes("좋") || text.includes("기쁘")) return "happy";
  if (text.includes("어려") || text.includes("힘들")) return "thinking";
  return "talk";
}

export function playSafe(
  model: LAppModel,
  group: string,
  index = 0,
  priority = LAppDefine.PriorityNormal,
): void {
  if (!model.hasMotion(group, index)) return;

  try {
    model.startMotion(group, index, priority);
  } catch {
    // ignore missing motions
  }
}

export function playMotion(model: LAppModel, motionType: MotionType): void {
  switch (motionType) {
    case "greeting":
      playSafe(model, LAppDefine.MotionGroupBody, 0, LAppDefine.PriorityNormal);
      playSafe(model, LAppDefine.MotionGroupTap, 0, LAppDefine.PriorityNormal);
      break;
    case "happy":
      playSafe(
        model,
        LAppDefine.MotionGroupTapBody,
        0,
        LAppDefine.PriorityNormal,
      );
      break;
    case "thinking":
      playSafe(model, LAppDefine.MotionGroupIdle, 1, LAppDefine.PriorityNormal);
      break;
    default:
      playSafe(model, LAppDefine.MotionGroupIdle, 0, LAppDefine.PriorityIdle);
      break;
  }
}

export function animateExpression(
  model: LAppModel,
  motionType: MotionType,
): void {
  const chooseExpression = () => {
    switch (motionType) {
      case "greeting":
      case "happy":
        return "smile";
      case "thinking":
        return "surprised";
      default:
        return "normal";
    }
  };

  const expressionId = chooseExpression();
  if (!model.hasExpression(expressionId)) return;

  try {
    model.setExpression(expressionId);
  } catch {
    // expression may not be available on all models
  }
}
