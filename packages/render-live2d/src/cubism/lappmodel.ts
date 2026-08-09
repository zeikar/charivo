/**
 * Live2D model wrapper adapted from the official Cubism TypeScript sample.
 *
 * Copyright(c) Live2D Inc. All rights reserved.
 * Licensed under the Live2D Open Software license:
 * https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html
 */

import { CubismDefaultParameterId } from "@framework/cubismdefaultparameterid";
import { CubismModelSettingJson } from "@framework/cubismmodelsettingjson";
import {
  CubismBreath,
  BreathParameterData,
} from "@framework/effect/cubismbreath";
import { CubismEyeBlink } from "@framework/effect/cubismeyeblink";
import { ICubismModelSetting } from "@framework/icubismmodelsetting";
import { CubismIdHandle } from "@framework/id/cubismid";
import { CubismFramework } from "@framework/live2dcubismframework";
import { CubismMatrix44 } from "@framework/math/cubismmatrix44";
import { CubismModel } from "@framework/model/cubismmodel";
import { CubismUserModel } from "@framework/model/cubismusermodel";
import {
  ACubismMotion,
  BeganMotionCallback,
  FinishedMotionCallback,
} from "@framework/motion/acubismmotion";
import { CubismMotion } from "@framework/motion/cubismmotion";
import {
  CubismMotionQueueEntryHandle,
  InvalidMotionQueueEntryHandleValue,
} from "@framework/motion/cubismmotionqueuemanager";
import { csmMap } from "@framework/type/csmmap";
import { csmVector } from "@framework/type/csmvector";
import { CubismLogError } from "@framework/utils/cubismdebug";

import * as LAppDefine from "./lappdefine";
import { LAppPal } from "./lapppal";
import { CubismModelHost } from "./model-host";
import { TextureInfo } from "./lapptexturemanager";
import { LAppWavFileHandler } from "./lappwavfilehandler";
import { PoseRestore } from "./pose-restore";

/**
 * Seconds over which parameters ease back to their default (rest) pose when a
 * motion finishes and the model has no "Idle" group to take over. Roughly
 * matches a motion fade so the settle reads as smooth rather than a snap.
 */
const IDLE_RESTORE_SECONDS = 0.5;

export class LAppModel extends CubismUserModel {
  private modelSetting: ICubismModelSetting | null = null;
  private modelHomeDir = "";
  private host: CubismModelHost | null = null;
  private motions = new csmMap<string, ACubismMotion>();
  private expressions = new csmMap<string, ACubismMotion>();

  // Release state for the applied expression. `activeExpressionFadeOutSeconds`
  // is the clamped FadeOutTime of the motion the last setExpression() started -
  // the only thing clearExpression() reads from that motion, so the motion
  // itself is not kept around; `pendingReleaseFadeSeconds` holds a release that
  // arrived before that expression had finished fading in, which the
  // per-frame expression step starts once it saturates - see clearExpression().
  private activeExpressionFadeOutSeconds: number | null = null;
  private pendingReleaseFadeSeconds: number | null = null;
  private eyeBlinkIds = new csmVector<CubismIdHandle>();
  private lipSyncIds = new csmVector<CubismIdHandle>();
  private ready = false;
  private wavHandler = new LAppWavFileHandler();
  private _userTimeSeconds = 0;

  // Eases parameters back to their defaults when a finished motion has no "Idle"
  // group to take over, so a one-shot gesture does not leave a residual pose.
  private readonly _poseRestore = new PoseRestore(IDLE_RESTORE_SECONDS);
  private realtimeLipSyncRms = 0;
  private useRealtimeLipSync = false;

  private readonly idParamAngleX = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamAngleX,
  );
  private readonly idParamAngleY = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamAngleY,
  );
  private readonly idParamAngleZ = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamAngleZ,
  );
  private readonly idParamEyeBallX = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamEyeBallX,
  );
  private readonly idParamEyeBallY = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamEyeBallY,
  );
  private readonly idParamBodyAngleX = CubismFramework.getIdManager().getId(
    CubismDefaultParameterId.ParamBodyAngleX,
  );

  public async loadAssets(
    modelPath: string,
    host: CubismModelHost,
  ): Promise<void> {
    this.host = host;

    const separator = modelPath.lastIndexOf("/") + 1;
    this.modelHomeDir = separator > 0 ? modelPath.substring(0, separator) : "";
    const fileName = modelPath.substring(separator);

    const settingBuffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${fileName}`,
    );
    const setting = new CubismModelSettingJson(
      settingBuffer,
      settingBuffer.byteLength,
    );
    this.modelSetting = setting;

    await this.loadCoreModel(setting);
    await this.loadExpressions(setting);
    await this.loadPhysicsData(setting);
    await this.loadPoseData(setting);
    this.setupEyeBlink(setting);
    this.setupBreath();
    await this.loadUserDataFile(setting);
    this.setupEyeBlinkIds(setting);
    this.setupLipSyncIds(setting);
    this.setupLayout(setting);
    await this.preloadMotions(setting);
    this.createRenderer();
    this.getRenderer().startUp(this.requireGl());
    await this.loadTextures(setting);

    this.ready = true;
    this.setUpdating(false);
    this.setInitialized(true);
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async waitUntilReady(): Promise<void> {
    if (this.ready) return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Live2D: model initialization timed out."));
      }, 15000);

      const poll = () => {
        if (this.ready) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        requestAnimationFrame(poll);
      };

      poll();
    });
  }

  public update(): void {
    if (!this.ready || !this.modelSetting) return;

    const deltaTimeSeconds = LAppPal.getDeltaTime();
    this._userTimeSeconds += deltaTimeSeconds;

    this._dragManager.update(deltaTimeSeconds);
    const dragX = this._dragManager.getX();
    const dragY = this._dragManager.getY();

    let motionUpdated = false;

    this._model.loadParameters();

    if (this._motionManager.isFinished()) {
      const idleHandle = this.startRandomMotion(
        LAppDefine.MotionGroupIdle,
        LAppDefine.PriorityIdle,
      );
      // Models without an "Idle" group would otherwise freeze on the finished
      // motion's last pose (load/saveParameters bakes it in). Ease parameters
      // back to their defaults so the body settles to rest. Models that DO have
      // an idle motion get a valid handle and never reach this branch.
      if (idleHandle === InvalidMotionQueueEntryHandleValue) {
        this._poseRestore.step(this._model, deltaTimeSeconds);
      } else {
        this._poseRestore.reset();
      }
    } else {
      motionUpdated = this._motionManager.updateMotion(
        this._model,
        deltaTimeSeconds,
      );
      this._poseRestore.reset();
    }
    this._model.saveParameters();

    if (!motionUpdated && this._eyeBlink) {
      this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
    }

    if (this._expressionManager) {
      this.updateExpressionFrame(this._model, deltaTimeSeconds);
    }

    this._model.addParameterValueById(this.idParamAngleX, dragX * 30);
    this._model.addParameterValueById(this.idParamAngleY, dragY * 30);
    this._model.addParameterValueById(this.idParamAngleZ, dragX * dragY * -30);
    this._model.addParameterValueById(this.idParamBodyAngleX, dragX * 10);
    this._model.addParameterValueById(this.idParamEyeBallX, dragX);
    this._model.addParameterValueById(this.idParamEyeBallY, dragY);

    if (this._breath) {
      this._breath.updateParameters(this._model, deltaTimeSeconds);
    }

    if (this._physics) {
      this._physics.evaluate(this._model, deltaTimeSeconds);
    }

    if (this._lipsync) {
      let lipSyncValue = 0;

      if (this.useRealtimeLipSync) {
        // Use real-time TTS audio analysis with increased amplification for web TTS
        lipSyncValue = this.realtimeLipSyncRms * 1.8; // Increase web TTS mouth movement
      } else {
        // Use traditional WAV file analysis for motion files
        this.wavHandler.update(deltaTimeSeconds);
        lipSyncValue = this.wavHandler.getRms();
      }

      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        this._model.addParameterValueById(
          this.lipSyncIds.at(i),
          lipSyncValue,
          0.8,
        );
      }
    }

    if (this._pose) {
      this._pose.updateParameters(this._model, deltaTimeSeconds);
    }

    // Apply TTS lip sync after all other updates to ensure it takes priority
    if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
      const lipSyncValue = this.realtimeLipSyncRms * 1.8; // Amplify web TTS lip sync

      // Override lip sync parameters with TTS data
      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        this._model.setParameterValueById(this.lipSyncIds.at(i), lipSyncValue);
      }
    }

    this._model.update();
  }

  public draw(projection: CubismMatrix44): void {
    if (!this.ready || !this.modelSetting || !this._model) return;

    projection.multiplyByMatrix(this._modelMatrix);

    const canvas = this.host?.getCanvas();
    if (!canvas) return;

    const viewport: number[] = [0, 0, canvas.width, canvas.height];
    const frameBuffer = this.host?.getFrameBuffer();
    const renderTarget = (frameBuffer ?? null) as unknown as WebGLFramebuffer;
    this.getRenderer().setRenderState(renderTarget, viewport);
    this.getRenderer().setMvpMatrix(projection);
    this.getRenderer().drawModel();
  }

  public startMotion(
    group: string,
    index: number,
    priority: number,
    onFinished?: FinishedMotionCallback,
    onBegan?: BeganMotionCallback,
  ): CubismMotionQueueEntryHandle {
    if (!this.ready || !this.modelSetting) {
      return InvalidMotionQueueEntryHandleValue;
    }

    if (priority === LAppDefine.PriorityForce) {
      this._motionManager.setReservePriority(priority);
    } else if (!this._motionManager.reserveMotion(priority)) {
      return InvalidMotionQueueEntryHandleValue;
    }

    const name = `${group}_${index}`;
    const motion = this.motions.getValue(name) as CubismMotion | undefined;
    if (!motion) {
      this._motionManager.setReservePriority(LAppDefine.PriorityNone);
      return InvalidMotionQueueEntryHandleValue;
    }

    if (onFinished) motion.setFinishedMotionHandler(onFinished);
    if (onBegan) motion.setBeganMotionHandler(onBegan);

    return this._motionManager.startMotionPriority(motion, false, priority);
  }

  public startRandomMotion(
    group: string,
    priority: number,
    onFinished?: FinishedMotionCallback,
    onBegan?: BeganMotionCallback,
  ): CubismMotionQueueEntryHandle {
    if (!this.modelSetting) {
      return InvalidMotionQueueEntryHandleValue;
    }

    const count = this.modelSetting.getMotionCount(group);
    if (count === 0) {
      return InvalidMotionQueueEntryHandleValue;
    }

    const index = Math.floor(Math.random() * count);
    return this.startMotion(group, index, priority, onFinished, onBegan);
  }

  public setExpression(expressionId: string): void {
    const motion = this.expressions.getValue(expressionId);
    if (motion && this._expressionManager) {
      this._expressionManager.startMotion(motion, false);
      // Math.max guards an authored negative FadeOutTime in the .exp3.json (e.g.
      // -2): CubismExpressionMotion.parse always calls setFadeOutTime with a
      // parsed float or its own 1.0 default, so ACubismMotion's -1 "unset"
      // default is unreachable here. A negative fade-in keeps the easing at 0
      // forever and would strand the face mid-expression, so the clamp turns an
      // authored negative into an instant release instead.
      this.activeExpressionFadeOutSeconds = Math.max(
        0,
        motion.getFadeOutTime(),
      );
      // A new expression supersedes a release still waiting on the previous
      // expression's fade-in; otherwise that release would fire once THIS
      // expression saturates and cut it short.
      this.pendingReleaseFadeSeconds = null;
    }
  }

  /**
   * Releases the applied expression so the face returns to its base pose.
   *
   * The return is the SDK's own expression crossfade: an empty expression (no
   * Parameters) is queued as a NEWER entry, so calculateExpressionParameters
   * eases every parameter the new entry does not reference back to its default
   * at that entry's fade weight, and the manager prunes the older entry once the
   * new one reaches full fade weight. The neutral entry fades in over the
   * released expression's own FadeOutTime, so an authored `FadeOutTime: 0` is
   * honored as the author's request for an instant release.
   *
   * Only `Add` and `Multiply` parameters fade, and only when that duration is
   * positive. `Overwrite` parameters snap to their base value in one frame,
   * because the SDK rebases the overwrite value from the model at the top of
   * every entry's parameter pass (cubismexpressionmotion.ts:140-141), leaving
   * nothing to interpolate from.
   *
   * A release requested before the expression has finished fading in is
   * deferred to the per-frame expression step below: starting the neutral
   * against an unsaturated expression makes the face MORE expressed first
   * (measured 0.35 -> 0.91), so the release waits for the fade-in to complete
   * and then fades. The wait is counted in rendered frames, so a paused
   * renderer simply defers - at the cost of an expression outliving its
   * nominal hold.
   *
   * Release requests are idempotent: a second call finds no applied expression.
   * What the residual neutral entry does to later frames is pinned by
   * __tests__/expression-release.test.ts rather than assumed here.
   */
  public clearExpression(): void {
    if (
      !this._expressionManager ||
      this.activeExpressionFadeOutSeconds === null
    )
      return;

    const fadeSeconds = this.activeExpressionFadeOutSeconds;

    if (this.isNewestEntrySaturated()) {
      this.startNeutralExpression(fadeSeconds);
    } else {
      this.pendingReleaseFadeSeconds = fadeSeconds;
    }

    this.activeExpressionFadeOutSeconds = null;
  }

  public hasMotion(group: string, index: number): boolean {
    const key = `${group}_${index}`;
    return this.motions.getValue(key) !== null;
  }

  public hasExpression(expressionId: string): boolean {
    return this.expressions.getValue(expressionId) !== null;
  }

  public getAvailableExpressions(): string[] {
    const expressionNames: string[] = [];
    const size = this.expressions.getSize();
    for (let i = 0; i < size; i++) {
      const keyValue = this.expressions._keyValues[i];
      if (keyValue) {
        expressionNames.push(keyValue.first);
      }
    }
    return expressionNames;
  }

  public getAvailableMotionGroups(): Record<string, number> {
    if (!this.modelSetting) return {};

    const motionGroups: Record<string, number> = {};
    const groupCount = this.modelSetting.getMotionGroupCount();

    for (let i = 0; i < groupCount; i++) {
      const group = this.modelSetting.getMotionGroupName(i);
      const motionCount = this.modelSetting.getMotionCount(group);
      motionGroups[group] = motionCount;
    }

    return motionGroups;
  }

  public hitTest(hitAreaName: string, x: number, y: number): boolean {
    if (!this.ready || this._opacity < 1 || !this.modelSetting) {
      return false;
    }

    const count = this.modelSetting.getHitAreasCount();
    for (let i = 0; i < count; i++) {
      if (this.modelSetting.getHitAreaName(i) === hitAreaName) {
        const drawId = this.modelSetting.getHitAreaId(i);
        return this.isHit(drawId, x, y);
      }
    }

    return false;
  }

  public setRealtimeLipSync(enabled: boolean, rms = 0): void {
    this.useRealtimeLipSync = enabled;
    this.realtimeLipSyncRms = rms;
  }

  public updateRealtimeLipSyncRms(rms: number): void {
    this.realtimeLipSyncRms = rms;
  }

  public release(): void {
    this.releaseMotions();
    this.releaseExpressions();
    this.wavHandler.stop();
    this.setRealtimeLipSync(false);
    this.ready = false;
  }

  private async loadCoreModel(setting: ICubismModelSetting): Promise<void> {
    if (!setting.getModelFileName()) {
      throw new Error("Live2D: Model data not specified in model3.json.");
    }

    const modelBuffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${setting.getModelFileName()}`,
    );

    this.loadModel(modelBuffer, LAppDefine.MOCConsistencyValidationEnable);
  }

  private async loadExpressions(setting: ICubismModelSetting): Promise<void> {
    const count = setting.getExpressionCount();
    for (let i = 0; i < count; i++) {
      const expressionName = setting.getExpressionName(i);
      const expressionFileName = setting.getExpressionFileName(i);
      const buffer = await this.fetchArrayBuffer(
        `${this.modelHomeDir}${expressionFileName}`,
      );
      const motion = this.loadExpression(
        buffer,
        buffer.byteLength,
        expressionName,
      );
      if (motion) {
        this.expressions.setValue(expressionName, motion);
      }
    }
  }

  private async loadPhysicsData(setting: ICubismModelSetting): Promise<void> {
    const fileName = setting.getPhysicsFileName();
    if (!fileName) return;

    const buffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${fileName}`,
    );
    super.loadPhysics(buffer, buffer.byteLength);
  }

  private async loadPoseData(setting: ICubismModelSetting): Promise<void> {
    const fileName = setting.getPoseFileName();
    if (!fileName) return;

    const buffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${fileName}`,
    );
    super.loadPose(buffer, buffer.byteLength);
  }

  private setupEyeBlink(setting: ICubismModelSetting): void {
    if (setting.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(setting);
    }
  }

  private setupBreath(): void {
    this._breath = CubismBreath.create();

    const breathParameters = new csmVector<BreathParameterData>();
    breathParameters.pushBack(
      new BreathParameterData(this.idParamAngleX, 0, 15, 6.5345, 0.5),
    );
    breathParameters.pushBack(
      new BreathParameterData(this.idParamAngleY, 0, 8, 3.5345, 0.5),
    );
    breathParameters.pushBack(
      new BreathParameterData(this.idParamAngleZ, 0, 10, 5.5345, 0.5),
    );
    breathParameters.pushBack(
      new BreathParameterData(this.idParamBodyAngleX, 0, 4, 15.5345, 0.5),
    );
    breathParameters.pushBack(
      new BreathParameterData(
        CubismFramework.getIdManager().getId(
          CubismDefaultParameterId.ParamBreath,
        ),
        0.5,
        0.5,
        3.2345,
        1,
      ),
    );

    this._breath.setParameters(breathParameters);
  }

  private async loadUserDataFile(setting: ICubismModelSetting): Promise<void> {
    const fileName = setting.getUserDataFile();
    if (!fileName) return;

    const buffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${fileName}`,
    );
    super.loadUserData(buffer, buffer.byteLength);
  }

  private setupEyeBlinkIds(setting: ICubismModelSetting): void {
    const count = setting.getEyeBlinkParameterCount();
    for (let i = 0; i < count; i++) {
      this.eyeBlinkIds.pushBack(setting.getEyeBlinkParameterId(i));
    }
  }

  private setupLipSyncIds(setting: ICubismModelSetting): void {
    const count = setting.getLipSyncParameterCount();

    for (let i = 0; i < count; i++) {
      const paramId = setting.getLipSyncParameterId(i);
      this.lipSyncIds.pushBack(paramId);
    }

    if (count === 0) {
      console.warn("Live2D model has no lip sync parameters.");
    }
  }

  private setupLayout(setting: ICubismModelSetting): void {
    const layout = new csmMap<string, number>();
    setting.getLayoutMap(layout);
    this._modelMatrix.setupFromLayout(layout);
  }

  private async preloadMotions(setting: ICubismModelSetting): Promise<void> {
    const groupCount = setting.getMotionGroupCount();
    for (let i = 0; i < groupCount; i++) {
      const group = setting.getMotionGroupName(i);
      const motionCount = setting.getMotionCount(group);
      for (let j = 0; j < motionCount; j++) {
        await this.loadMotionIntoCache(setting, group, j);
      }
    }

    this._motionManager.stopAllMotions();
  }

  private async loadMotionIntoCache(
    setting: ICubismModelSetting,
    group: string,
    index: number,
  ): Promise<void> {
    const motionFileName = setting.getMotionFileName(group, index);
    if (!motionFileName) return;

    const key = `${group}_${index}`;
    const buffer = await this.fetchArrayBuffer(
      `${this.modelHomeDir}${motionFileName}`,
    );
    const motion = this.loadMotion(
      buffer,
      buffer.byteLength,
      key,
      undefined,
      undefined,
      setting,
      group,
      index,
      LAppDefine.MotionConsistencyValidationEnable,
    );

    if (!motion) {
      CubismLogError(`Live2D: Failed to load motion file ${motionFileName}`);
      return;
    }

    motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);

    if (setting.getMotionSoundFileName(group, index)) {
      motion.setFinishedMotionHandler(() => this.wavHandler.stop());
      motion.setBeganMotionHandler(() =>
        this.wavHandler.start(
          `${this.modelHomeDir}${setting.getMotionSoundFileName(group, index)}`,
        ),
      );
    }

    this.motions.setValue(key, motion);
  }

  private async loadTextures(setting: ICubismModelSetting): Promise<void> {
    const textureCount = setting.getTextureCount();
    const loadPromises: Promise<void>[] = [];
    const textureManager = this.host?.getTextureManager();
    if (!textureManager)
      throw new Error("Live2D: Texture manager unavailable.");

    for (let i = 0; i < textureCount; i++) {
      const fileName = setting.getTextureFileName(i);
      if (!fileName) continue;

      const path = `${this.modelHomeDir}${fileName}`;
      loadPromises.push(
        new Promise<void>((resolve) => {
          textureManager.createTextureFromPngFile(
            path,
            true,
            (textureInfo: TextureInfo) => {
              if (textureInfo.id) {
                this.getRenderer().bindTexture(i, textureInfo.id);
              }
              resolve();
            },
          );
        }),
      );
    }

    await Promise.all(loadPromises);
    this.getRenderer().setIsPremultipliedAlpha(true);
  }

  private async fetchArrayBuffer(path: string): Promise<ArrayBuffer> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Live2D: Failed to load ${path} (${response.status})`);
    }
    return await response.arrayBuffer();
  }

  private releaseMotions(): void {
    this.motions.clear();
    this._motionManager.stopAllMotions();
  }

  /**
   * Expression step of update(), extracted so a deferred release can start on
   * the frame after the outgoing expression is fully faded in.
   */
  protected updateExpressionFrame(
    model: CubismModel,
    deltaTimeSeconds: number,
  ): void {
    if (
      this.pendingReleaseFadeSeconds !== null &&
      this.isNewestEntrySaturated()
    ) {
      this.startNeutralExpression(this.pendingReleaseFadeSeconds);
      this.pendingReleaseFadeSeconds = null;
    }

    this._expressionManager.updateMotion(model, deltaTimeSeconds);
  }

  /**
   * Whether the newest queue entry - always the applied expression's, since the
   * only other enqueue is a neutral that ends the expression - has reached full
   * fade weight, the same signal the manager's own prune uses.
   */
  private isNewestEntrySaturated(): boolean {
    const entries = this._expressionManager.getCubismMotionQueueEntries();
    const lastIndex = entries.getSize() - 1;
    if (lastIndex < 0) return false;

    // isStarted() keeps getFadeWeight() off its warn-and-return-(-1) path: no
    // frame has run since startMotion(), so there is no weight yet - which is
    // simply "not saturated", and the release defers.
    return (
      entries.at(lastIndex).isStarted() &&
      this._expressionManager.getFadeWeight(lastIndex) >= 1.0
    );
  }

  private startNeutralExpression(fadeInSeconds: number): void {
    // A fresh instance per release: updateFadeWeight() reads the motion's
    // fade-in seconds live, so a shared instance would retroactively bend the
    // curve of an earlier neutral still fading with a different duration.
    const neutralJson = JSON.stringify({
      Type: "Live2D Expression",
      FadeInTime: fadeInSeconds,
      FadeOutTime: 0,
      Parameters: [],
    });
    const buffer = new TextEncoder().encode(neutralJson).buffer;

    // No null guard here: unlike loadExpressions() reading external .exp3.json
    // files, this buffer is a JSON string we build above, so it is never empty
    // and loadExpression()'s guard can never trigger.
    this._expressionManager.startMotion(
      this.loadExpression(buffer, buffer.byteLength, "neutral"),
      false,
    );
  }

  private releaseExpressions(): void {
    this.expressions.clear();
    this.activeExpressionFadeOutSeconds = null;
    this.pendingReleaseFadeSeconds = null;
  }

  private requireGl(): WebGLRenderingContext | WebGL2RenderingContext {
    if (!this.host) {
      throw new Error("Live2D: renderer host is not set.");
    }
    return this.host.getGlManager().getGl();
  }
}
