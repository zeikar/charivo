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

export class LAppModel extends CubismUserModel {
  private modelSetting: ICubismModelSetting | null = null;
  private modelHomeDir = "";
  private host: CubismModelHost | null = null;
  private motions = new csmMap<string, ACubismMotion>();
  private expressions = new csmMap<string, ACubismMotion>();
  private eyeBlinkIds = new csmVector<CubismIdHandle>();
  private lipSyncIds = new csmVector<CubismIdHandle>();
  private ready = false;
  private wavHandler = new LAppWavFileHandler();
  private _userTimeSeconds = 0;
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
    console.log(`🎯 LAppModel: Loading model from ${modelPath}`);
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

    // 🚨 DEBUG: List ALL available parameters in this model
    console.log(
      `🔍 LAppModel: Model has ${this._model.getParameterCount()} parameters:`,
    );
    for (let i = 0; i < this._model.getParameterCount(); i++) {
      const paramId = this._model.getParameterId(i);
      const paramValue = this._model.getParameterValueByIndex(i);
      console.log(
        `🔍 Parameter ${i}:`,
        paramId,
        `value=${paramValue.toFixed(3)}`,
      );

      // Test setting each parameter to see which ones actually work
      if (paramId && paramValue !== undefined) {
        this._model.setParameterValueById(paramId, 0.5);
        const testValue = this._model.getParameterValueById(paramId);
        console.log(`🧪 Test param ${i}: set 0.5, got ${testValue.toFixed(3)}`);
      }
    }

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

    // 🚨 DEBUG: Log motion state when TTS is active
    if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
      console.log(
        `🎬 LAppModel: Motion state during TTS - finished: ${this._motionManager.isFinished()}, TTS active: ${this.useRealtimeLipSync}`,
      );
    }

    if (this._motionManager.isFinished()) {
      // Only start new motion if TTS is not active
      if (!this.useRealtimeLipSync || this.realtimeLipSyncRms === 0) {
        this.startRandomMotion(
          LAppDefine.MotionGroupIdle,
          LAppDefine.PriorityIdle,
        );
      } else {
        console.log(`🎬 LAppModel: Skipping new motion start during TTS`);
      }
    } else {
      motionUpdated = this._motionManager.updateMotion(
        this._model,
        deltaTimeSeconds,
      );

      if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
        console.log(
          `🎬 LAppModel: Motion updated during TTS: ${motionUpdated}`,
        );
      }
    }
    this._model.saveParameters();

    if (!motionUpdated && this._eyeBlink) {
      this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
    }

    if (this._expressionManager) {
      this._expressionManager.updateMotion(this._model, deltaTimeSeconds);
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

    // 🚨 IMPORTANT: Apply lip sync REGARDLESS of motion state when TTS is active
    if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
      const lipSyncValue = this.realtimeLipSyncRms;
      console.log(
        `👄 LAppModel: TTS ACTIVE - FORCE lip sync override: ${lipSyncValue.toFixed(3)} (motionUpdated: ${motionUpdated})`,
      );

      // Apply lip sync with maximum weight to override motion
      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        const paramId = this.lipSyncIds.at(i);
        const beforeValue = this._model.getParameterValueById(paramId);

        // Use setParameterValueById instead of addParameterValueById to completely override
        this._model.setParameterValueById(paramId, lipSyncValue);

        const afterValue = this._model.getParameterValueById(paramId);
        console.log(
          `🎯 LAppModel: TTS OVERRIDE Parameter ${i} - before: ${beforeValue.toFixed(3)}, after: ${afterValue.toFixed(3)}, set: ${lipSyncValue.toFixed(3)}`,
        );
      }

      // Also directly set ParamMouthOpenY for maximum visibility
      const mouthId = CubismFramework.getIdManager().getId("ParamMouthOpenY");
      console.log(
        `👄 LAppModel: TTS FORCE ParamMouthOpenY to ${lipSyncValue.toFixed(3)}`,
      );
      this._model.setParameterValueById(mouthId, lipSyncValue);
    } else if (this._lipsync && !this.useRealtimeLipSync) {
      // Original lip sync logic for motion files
      let lipSyncValue = 0;

      if (this.useRealtimeLipSync) {
        lipSyncValue = this.realtimeLipSyncRms;
      } else {
        this.wavHandler.update(deltaTimeSeconds);
        lipSyncValue = this.wavHandler.getRms();
      }

      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        const paramId = this.lipSyncIds.at(i);
        this._model.addParameterValueById(paramId, lipSyncValue, 0.8);
      }
    }

    if (this._pose) {
      this._pose.updateParameters(this._model, deltaTimeSeconds);
    }

    // 🚨 ULTIMATE FINAL OVERRIDE: Apply TTS lip sync as the absolute last step
    if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
      const lipSyncValue = this.realtimeLipSyncRms;
      console.log(
        `🔥🔥 LAppModel: ULTIMATE TTS override: ${lipSyncValue.toFixed(3)} (CRUSHING all animations)`,
      );

      // Force set mouth parameter multiple times to ensure it sticks
      const mouthId = CubismFramework.getIdManager().getId("ParamMouthOpenY");
      this._model.setParameterValueById(mouthId, lipSyncValue);

      // Also apply to lip sync IDs if they exist
      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        const paramId = this.lipSyncIds.at(i);
        const beforeFinal = this._model.getParameterValueById(paramId);
        this._model.setParameterValueById(paramId, lipSyncValue);
        const afterFinal = this._model.getParameterValueById(paramId);
        console.log(
          `🔥 LAppModel: ULTIMATE param ${i} - before: ${beforeFinal.toFixed(3)}, after: ${afterFinal.toFixed(3)}`,
        );
      }

      // Triple-check: set ParamMouthOpenY again after lip sync IDs
      this._model.setParameterValueById(mouthId, lipSyncValue);
      const finalMouthValue = this._model.getParameterValueById(mouthId);
      console.log(
        `🔥 LAppModel: Final ParamMouthOpenY check: ${finalMouthValue.toFixed(3)} (should be ${lipSyncValue.toFixed(3)})`,
      );
    }

    this._model.update();
  }

  public draw(projection: CubismMatrix44): void {
    if (!this.ready || !this.modelSetting || !this._model) return;

    // 🚨 LAST RESORT: Force lip sync RIGHT BEFORE RENDERING
    if (this.useRealtimeLipSync && this.realtimeLipSyncRms > 0) {
      const lipSyncValue = this.realtimeLipSyncRms;
      console.log(
        `🎨 LAppModel: RENDER-TIME lip sync HACK: ${lipSyncValue.toFixed(3)}`,
      );

      // Force set MULTIPLE parameters for testing what actually works
      const mouthId = CubismFramework.getIdManager().getId("ParamMouthOpenY");
      this._model.setParameterValueById(mouthId, lipSyncValue);

      // Test other mouth-related parameters
      const mouthFormId =
        CubismFramework.getIdManager().getId("ParamMouthForm");
      this._model.setParameterValueById(mouthFormId, lipSyncValue);

      // Test eye parameters to see if ANY parameters work during render time
      this._model.setParameterValueById(
        this.idParamEyeBallX,
        lipSyncValue * 0.5,
      );
      this._model.setParameterValueById(
        this.idParamEyeBallY,
        lipSyncValue * 0.5,
      );

      // Also set all lip sync parameters
      for (let i = 0; i < this.lipSyncIds.getSize(); i++) {
        const paramId = this.lipSyncIds.at(i);
        this._model.setParameterValueById(paramId, lipSyncValue);
      }

      console.log(
        `🎨 LAppModel: TESTING - Mouth: ${this._model.getParameterValueById(mouthId).toFixed(3)}, Eye: ${this._model.getParameterValueById(this.idParamEyeBallX).toFixed(3)}`,
      );
    }

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
    }
  }

  public hasMotion(group: string, index: number): boolean {
    const key = `${group}_${index}`;
    return this.motions.getValue(key) !== null;
  }

  public hasExpression(expressionId: string): boolean {
    return this.expressions.getValue(expressionId) !== null;
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
    console.log(`🎤 LAppModel: Setting realtime lip sync: ${enabled}`, { rms });
    this.useRealtimeLipSync = enabled;
    this.realtimeLipSyncRms = rms;
  }

  public updateRealtimeLipSyncRms(rms: number): void {
    this.realtimeLipSyncRms = rms;
    // Only log significant changes to avoid spam (higher threshold)
    if (rms > 0.3) {
      console.log(`📊 LAppModel: Updated RMS to ${rms.toFixed(3)}`);
    }
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
    console.log(`🎯 LAppModel: Setting up ${count} lip sync parameters`);

    for (let i = 0; i < count; i++) {
      const paramId = setting.getLipSyncParameterId(i);
      this.lipSyncIds.pushBack(paramId);
      console.log(`🎯 LAppModel: Lip sync parameter ${i}:`, paramId);
    }

    if (count === 0) {
      console.warn(`⚠️ LAppModel: No lip sync parameters found in model!`);
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

  private releaseExpressions(): void {
    this.expressions.clear();
  }

  private requireGl(): WebGLRenderingContext | WebGL2RenderingContext {
    if (!this.host) {
      throw new Error("Live2D: renderer host is not set.");
    }
    return this.host.getGlManager().getGl();
  }
}
