import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CubismFramework } from "@framework/live2dcubismframework";
import { CubismIdHandle } from "@framework/id/cubismid";
import { CubismModel } from "@framework/model/cubismmodel";
import { CubismExpressionMotion } from "@framework/motion/cubismexpressionmotion";

import { LAppModel } from "../src/cubism/lappmodel";

// Cubism's startUp()/initialize() read the ambient Live2DCubismCore global.
// Stub it through the same Record cast cubism-core.dom.test.ts uses: the ambient
// declaration is non-optional and fully typed, so a direct typed assignment (or
// `delete`) would not compile under `pnpm typecheck:tests`.
// Divergence from that test: it only stubs Version.csmGetVersion, while this one
// really runs startUp() + initialize(), which also calls
// Memory.initializeAmountOfMemory.
const stubCubismCore = () => {
  (globalThis as Record<string, unknown>).Live2DCubismCore = {
    Version: { csmGetVersion: () => 0x04020000 },
    Memory: { initializeAmountOfMemory: () => undefined },
  };
};

const clearCubismCore = () => {
  delete (globalThis as Record<string, unknown>).Live2DCubismCore;
};

const PARAMETER_ID = "ParamMouthForm";
const FADE_IN_SECONDS = 0.5;
const BASELINE_VALUE = 0;
const EXPRESSED_VALUE = 1;

const EXPRESSION_JSON = JSON.stringify({
  Type: "Live2D Expression",
  FadeInTime: FADE_IN_SECONDS,
  FadeOutTime: 0.5,
  Parameters: [{ Id: PARAMETER_ID, Value: EXPRESSED_VALUE, Blend: "Add" }],
});

/**
 * Exposes the pieces of the expression pipeline that `LAppModel.update()` drives
 * per frame. The full `update()` needs the WASM core model, so the expression
 * step is driven directly - but the release under test stays the real
 * production method, `clearExpression()`.
 */
class TestLAppModel extends LAppModel {
  public startExpressionMotion(motion: CubismExpressionMotion): void {
    this._expressionManager.startMotion(motion, false);
  }

  public driveExpressionFrame(
    model: CubismModel,
    deltaTimeSeconds: number,
  ): void {
    this._expressionManager.updateMotion(model, deltaTimeSeconds);
  }
}

/**
 * Minimal stand-in for CubismModel holding a single parameter. Blend math is
 * copied from CubismModel.setParameterValueByIndex.
 */
class SingleParameterModel {
  public value = BASELINE_VALUE;

  public getParameterValueById(_id: CubismIdHandle): number {
    return this.value;
  }

  public setParameterValueById(
    _id: CubismIdHandle,
    value: number,
    weight = 1.0,
  ): void {
    this.value =
      weight === 1 ? value : this.value * (1 - weight) + value * weight;
  }
}

beforeAll(() => {
  stubCubismCore();
  CubismFramework.startUp();
  CubismFramework.initialize();
});

afterAll(() => {
  clearCubismCore();
});

describe("LAppModel.clearExpression", () => {
  it("drops the applied expression so the base parameter value returns", () => {
    const model = new TestLAppModel();
    const target = new SingleParameterModel();
    const buffer = new TextEncoder().encode(EXPRESSION_JSON).buffer;
    const motion = CubismExpressionMotion.create(buffer, buffer.byteLength);

    // Mirrors LAppModel.update(): loadParameters() restores the saved snapshot
    // before the expression manager writes on top of it. The reset is required
    // for fidelity, not convenience: calculateExpressionParameters recomputes
    // overwriteValue from the model's CURRENT value each frame, so without it an
    // Add expression compounds (0 -> 1 -> 1.345 -> ...). It also does not
    // pre-ordain the final assertion — with a live queue entry the apply loop
    // writes the expressed value straight over this baseline at weight 1.
    const frame = (deltaTimeSeconds: number) => {
      target.value = BASELINE_VALUE;
      model.driveExpressionFrame(
        target as unknown as CubismModel,
        deltaTimeSeconds,
      );
    };

    model.startExpressionMotion(motion);
    // 8 x 0.1s = 0.8s, past the 0.5s FadeInTime in EXPRESSION_JSON, so the
    // expression weight saturates at 1 and the value is fully applied.
    for (let i = 0; i < 8; i++) {
      frame(0.1);
    }

    expect(target.value).toBe(EXPRESSED_VALUE);

    model.clearExpression();
    frame(0.1);

    expect(target.value).toBe(BASELINE_VALUE);
  });
});
