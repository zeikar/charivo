import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CubismFramework } from "@framework/live2dcubismframework";
import { CubismIdHandle } from "@framework/id/cubismid";
import { CubismModel } from "@framework/model/cubismmodel";
import { CubismExpressionMotion } from "@framework/motion/cubismexpressionmotion";
import { CubismExpressionMotionManager } from "@framework/motion/cubismexpressionmotionmanager";
import { CubismMotionManager } from "@framework/motion/cubismmotionmanager";

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

/**
 * Drives the REAL LAppModel.update() so this test observes production call
 * ordering directly, rather than the ordering the test above assumes by
 * construction inside its own frame() helper.
 *
 * `_model`, `_motionManager` and `_expressionManager` are protected on
 * CubismUserModel, so a subclass can swap in fakes before calling update().
 * `ready` and `modelSetting` are private on LAppModel and are only ever set by
 * loadAssets(), which needs the WASM core - so this subclass casts past them
 * to satisfy update()'s `if (!this.ready || !this.modelSetting) return;` guard
 * without going through model loading.
 */
class OrderingTestLAppModel extends LAppModel {
  public installFakes(
    model: CubismModel,
    motionManager: CubismMotionManager,
    expressionManager: CubismExpressionMotionManager,
  ): void {
    this._model = model;
    this._motionManager = motionManager;
    this._expressionManager = expressionManager;

    // _lipsync defaults to true, so update()'s lip-sync block would otherwise
    // run against the real LAppWavFileHandler. That is a no-op while inactive
    // today, but this test exists to stop depending on assumptions it does not
    // assert - so switch the branch off rather than rely on that staying true.
    this._lipsync = false;

    const readyOverride = this as unknown as {
      ready: boolean;
      modelSetting: unknown;
    };
    readyOverride.ready = true;
    readyOverride.modelSetting = {};
  }
}

/**
 * Records loadParameters/saveParameters/update calls, in call order, into a
 * shared array so the expression manager fake below can interleave its own
 * call into the same sequence.
 */
class RecordingModel {
  public readonly calls: string[] = [];

  public loadParameters(): void {
    this.calls.push("model.loadParameters");
  }

  public saveParameters(): void {
    this.calls.push("model.saveParameters");
  }

  // Drag-follow parameters (angle/eye-ball); irrelevant to the ordering
  // assertion, so not recorded.
  public addParameterValueById(): void {}

  public update(): void {
    this.calls.push("model.update");
  }
}

// isFinished() must return false so update() takes the updateMotion() branch
// instead of startRandomMotion(), which needs real modelSetting motion data.
class StubMotionManager {
  public isFinished(): boolean {
    return false;
  }

  public updateMotion(): boolean {
    return false;
  }
}

class RecordingExpressionManager {
  public constructor(private readonly calls: string[]) {}

  public updateMotion(): boolean {
    this.calls.push("expressionManager.updateMotion");
    return false;
  }
}

describe("LAppModel.update() ordering invariant", () => {
  it("saves parameters before the expression manager writes on top of them", () => {
    const recordingModel = new RecordingModel();
    const model = new OrderingTestLAppModel();
    model.installFakes(
      recordingModel as unknown as CubismModel,
      new StubMotionManager() as unknown as CubismMotionManager,
      new RecordingExpressionManager(
        recordingModel.calls,
      ) as unknown as CubismExpressionMotionManager,
    );

    model.update();

    const loadIndex = recordingModel.calls.indexOf("model.loadParameters");
    const saveIndex = recordingModel.calls.indexOf("model.saveParameters");
    const expressionIndex = recordingModel.calls.indexOf(
      "expressionManager.updateMotion",
    );

    expect(loadIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(expressionIndex).toBeGreaterThanOrEqual(0);
    expect(loadIndex).toBeLessThan(saveIndex);
    expect(saveIndex).toBeLessThan(expressionIndex);
  });
});
