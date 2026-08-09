import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CubismFramework } from "@framework/live2dcubismframework";
import { CubismIdHandle } from "@framework/id/cubismid";
import { CubismModel } from "@framework/model/cubismmodel";
import { ACubismMotion } from "@framework/motion/acubismmotion";
import { CubismExpressionMotion } from "@framework/motion/cubismexpressionmotion";
import { CubismExpressionMotionManager } from "@framework/motion/cubismexpressionmotionmanager";
import { CubismMotionManager } from "@framework/motion/cubismmotionmanager";
import { csmMap } from "@framework/type/csmmap";

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

const EXPRESSION_ID = "test";
const PARAMETER_ID = "ParamMouthForm";
const ADD_PARAMETER_ID = "ParamA";
const OVERWRITE_PARAMETER_ID = "ParamB";
const FADE_IN_SECONDS = 0.5;
// Deliberately different from FADE_IN_SECONDS: the release fade is driven by the
// expression's FadeOutTime, so sourcing it from FadeInTime lands on another curve.
// Also deliberately different from CubismExpressionMotion's own DefaultFadeTime
// (1.0s, cubismexpressionmotion.ts:26): 1.0 would pass even if the production
// code read a hardcoded 1.0 instead of the expression's actual FadeOutTime.
const FADE_OUT_SECONDS = 0.8;
const BASELINE_VALUE = 0;
const EXPRESSED_VALUE = 1;

const EXPRESSION_JSON = JSON.stringify({
  Type: "Live2D Expression",
  FadeInTime: FADE_IN_SECONDS,
  FadeOutTime: FADE_OUT_SECONDS,
  Parameters: [{ Id: PARAMETER_ID, Value: EXPRESSED_VALUE, Blend: "Add" }],
});

const MIXED_BLEND_EXPRESSION_JSON = JSON.stringify({
  Type: "Live2D Expression",
  FadeInTime: FADE_IN_SECONDS,
  FadeOutTime: FADE_OUT_SECONDS,
  Parameters: [
    { Id: ADD_PARAMETER_ID, Value: EXPRESSED_VALUE, Blend: "Add" },
    { Id: OVERWRITE_PARAMETER_ID, Value: EXPRESSED_VALUE, Blend: "Overwrite" },
  ],
});

/**
 * Drives the expression pipeline through production code only: expressions enter
 * via `setExpression()`, leave via `clearExpression()`, and frames run through
 * `updateExpressionFrame()` - the same wrapper `update()` calls. The full
 * `update()` needs the WASM core model, hence the wrapper rather than `update()`.
 *
 * `expressions` is private on LAppModel and is only ever filled by loadAssets(),
 * which needs the WASM core - so injection casts past it, the same way
 * OrderingTestLAppModel casts past `ready`/`modelSetting` below.
 */
class TestLAppModel extends LAppModel {
  public injectExpression(id: string, motion: ACubismMotion): void {
    const expressionsOverride = this as unknown as {
      expressions: csmMap<string, ACubismMotion>;
    };
    expressionsOverride.expressions.setValue(id, motion);
  }

  public expressionQueueSize(): number {
    return this._expressionManager.getCubismMotionQueueEntries().getSize();
  }

  public driveExpressionFrame(
    model: CubismModel,
    deltaTimeSeconds: number,
  ): void {
    this.updateExpressionFrame(model, deltaTimeSeconds);
  }
}

/**
 * Minimal stand-in for CubismModel holding parameters by id handle (handles are
 * interned by CubismIdManager, so identity is stable). Blend math is copied from
 * CubismModel.setParameterValueByIndex.
 */
class ParameterModel {
  private readonly values = new Map<CubismIdHandle, number>();

  public constructor(private readonly ids: CubismIdHandle[]) {
    this.setAll(BASELINE_VALUE);
  }

  /** Stands in for the loadParameters() restore that precedes the expression step. */
  public setAll(value: number): void {
    for (const id of this.ids) {
      this.values.set(id, value);
    }
  }

  public read(id: CubismIdHandle): number {
    return this.values.get(id) ?? BASELINE_VALUE;
  }

  public getParameterValueById(id: CubismIdHandle): number {
    return this.read(id);
  }

  public setParameterValueById(
    id: CubismIdHandle,
    value: number,
    weight = 1.0,
  ): void {
    const current = this.read(id);
    this.values.set(
      id,
      weight === 1 ? value : current * (1 - weight) + value * weight,
    );
  }
}

const parameterId = (name: string) =>
  CubismFramework.getIdManager().getId(name);

const createModel = (expressionJson: string): TestLAppModel => {
  const model = new TestLAppModel();
  const buffer = new TextEncoder().encode(expressionJson).buffer;
  model.injectExpression(
    EXPRESSION_ID,
    CubismExpressionMotion.create(buffer, buffer.byteLength),
  );
  return model;
};

/**
 * One frame: whatever motion and eye blink would have written lands first (the
 * ordering the untouched invariant test below pins), then the expression step
 * runs on top of it. `incoming` varies per frame in the passthrough assertions,
 * so a residual entry writing a constant cannot pass for a passthrough.
 */
const makeFrame =
  (model: TestLAppModel, target: ParameterModel) =>
  (deltaTimeSeconds: number, incoming = BASELINE_VALUE) => {
    target.setAll(incoming);
    model.driveExpressionFrame(
      target as unknown as CubismModel,
      deltaTimeSeconds,
    );
  };

beforeAll(() => {
  stubCubismCore();
  CubismFramework.startUp();
  CubismFramework.initialize();
});

afterAll(() => {
  clearCubismCore();
});

describe("LAppModel.clearExpression", () => {
  it("fades the applied expression out over its FadeOutTime instead of snapping", () => {
    const model = createModel(EXPRESSION_JSON);
    const id = parameterId(PARAMETER_ID);
    const target = new ParameterModel([id]);
    const frame = makeFrame(model, target);

    model.setExpression(EXPRESSION_ID);
    // 8 x 0.1s = 0.8s, past the 0.5s FadeInTime, so the expression saturates and
    // clearExpression() takes the immediate path (the deferred path is separate).
    for (let i = 0; i < 8; i++) {
      frame(0.1);
    }
    expect(target.read(id)).toBe(EXPRESSED_VALUE);

    model.clearExpression();

    // The neutral entry's fade-in starts on this frame, at elapsed 0 and weight
    // 0, so the face is still fully expressed. A snap release reads baseline here.
    frame(0.1);
    expect(target.read(id)).toBe(EXPRESSED_VALUE);

    // Neutral fade elapsed 0.1 ... 0.7 of its 0.8s FadeInTime (= the released
    // expression's FadeOutTime).
    const fading: number[] = [];
    for (let i = 0; i < 7; i++) {
      frame(0.1);
      fading.push(target.read(id));
    }

    fading.forEach((value, index) => {
      // No release at all pins these at EXPRESSED_VALUE; a snap drops them to
      // BASELINE_VALUE. Either way the open interval fails.
      expect(value).toBeGreaterThan(BASELINE_VALUE);
      expect(value).toBeLessThan(EXPRESSED_VALUE);
      if (index > 0) {
        expect(value).toBeLessThan(fading[index - 1]);
      }
    });

    // 1 - getEasingSine(0.4 / 0.8) = 0.5 at the halfway point. Deriving the fade
    // from the expression's FadeInTime (0.5s) would have finished by now, at 0.
    expect(fading[3]).toBeCloseTo(0.5, 5);

    // Elapsed 0.8: the fade weight clamps to 1, so the parameter lands exactly on
    // baseline and the manager prunes the outgoing expression entry.
    frame(0.1);
    expect(target.read(id)).toBe(BASELINE_VALUE);
    expect(model.expressionQueueSize()).toBe(1);

    // The residual neutral entry must be a passthrough of whatever the frame's
    // earlier stages wrote. Values vary per frame, so an entry that writes a
    // constant (zeros, a stale value) cannot pass this.
    for (const incoming of [0.3, -0.25, 0.7, 0.42]) {
      frame(0.1, incoming);
      expect(target.read(id)).toBe(incoming);
      expect(model.expressionQueueSize()).toBe(1);
    }
  });

  // Pins a user-approved SDK limitation, not desired behavior:
  // calculateExpressionParameters rebases overwriteValue from the model at the
  // top of every entry's pass, so by the time the neutral entry runs there is no
  // outgoing overwrite value left to interpolate from. Turns red if a future SDK
  // upgrade changes that rebase in either direction.
  it("snaps Overwrite parameters on release while Add parameters still fade", () => {
    const model = createModel(MIXED_BLEND_EXPRESSION_JSON);
    const addId = parameterId(ADD_PARAMETER_ID);
    const overwriteId = parameterId(OVERWRITE_PARAMETER_ID);
    const target = new ParameterModel([addId, overwriteId]);
    const frame = makeFrame(model, target);

    model.setExpression(EXPRESSION_ID);
    for (let i = 0; i < 8; i++) {
      frame(0.1);
    }
    expect(target.read(addId)).toBe(EXPRESSED_VALUE);
    expect(target.read(overwriteId)).toBe(EXPRESSED_VALUE);

    model.clearExpression();

    // One frame in: the Add parameter is untouched (neutral at weight 0) while
    // the Overwrite parameter is already back at its base value.
    frame(0.1);
    expect(target.read(addId)).toBe(EXPRESSED_VALUE);
    expect(target.read(overwriteId)).toBe(BASELINE_VALUE);

    let previousAdd = EXPRESSED_VALUE;
    for (let i = 0; i < 7; i++) {
      frame(0.1);
      const add = target.read(addId);
      expect(add).toBeGreaterThan(BASELINE_VALUE);
      expect(add).toBeLessThan(previousAdd);
      expect(target.read(overwriteId)).toBe(BASELINE_VALUE);
      previousAdd = add;
    }

    frame(0.1);
    expect(target.read(addId)).toBe(BASELINE_VALUE);
    expect(target.read(overwriteId)).toBe(BASELINE_VALUE);
    expect(model.expressionQueueSize()).toBe(1);
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
