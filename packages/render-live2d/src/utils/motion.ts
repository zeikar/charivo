import type { LAppModel } from "../cubism/lappmodel";
import * as LAppDefine from "../cubism/lappdefine";

/**
 * Safely play a motion if it exists
 */
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
