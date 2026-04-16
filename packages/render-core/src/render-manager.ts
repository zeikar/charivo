import {
  type AvatarActionPreset,
  type Character,
  type Emotion,
  type GazeCoordinates,
  type Message,
  type MotionSelection,
  type Renderer,
  type RenderManager as IRenderManager,
  type CharivoEventBus,
} from "@charivo/core";
import { RealTimeLipSync } from "./lipsync";
import {
  setupMouseTracking,
  type MouseTrackable,
  type MouseTrackingCleanup,
  type MouseTrackingMode,
} from "./mouse-tracking";

const EXPLICIT_ACTION_HOLD_MS = 1_200;
const EXPRESSION_DEBOUNCE_MS = 300;
const MOTION_DEBOUNCE_MS = 1_000;

type ActionSource = "explicit" | "compat";

/**
 * Render Manager - 렌더링 세션의 상태 관리를 담당하는 클래스
 *
 * 역할:
 * - 렌더러 관리 및 래핑
 * - 이벤트 버스 연결 및 이벤트 처리
 * - 립싱크 처리 및 조율
 * - 모션 및 표현 제어
 * - 마우스 추적 관리
 * - 캐릭터 설정 관리
 * - 메시지 렌더링 조율
 *
 * RenderManager는 어떤 Renderer든 받을 수 있으며,
 * 렌더러가 지원하는 기능(motion, lipsync, mouse tracking 등)을 선택적으로 사용합니다.
 */
export interface RenderManagerOptions {
  canvas?: HTMLCanvasElement;
  mouseTracking?: MouseTrackingMode;
}

export class RenderManager implements IRenderManager {
  private readonly lipSync = new RealTimeLipSync();
  private readonly renderer: Renderer;
  private character: Character | null = null;
  private messageCallback?: (message: Message, character?: Character) => void;
  private cleanupMouseTracking?: MouseTrackingCleanup;
  private resumeMouseTrackingTimer?: ReturnType<typeof setTimeout>;
  private explicitActionUntil = 0;
  private mouseTrackingSuspendedUntil = 0;
  private lastExpression?: { expressionId: string; at: number };
  private lastMotion?: { group: string; index: number; at: number };

  constructor(
    renderer: Renderer,
    private options?: RenderManagerOptions,
  ) {
    this.renderer = renderer;
  }

  /**
   * 이벤트 버스 연결
   */
  setEventBus(eventBus: CharivoEventBus): void {
    eventBus.on("tts:audio:start", (data) => {
      this.startRealtimeLipSync(data.audioElement);
    });

    eventBus.on("tts:audio:end", () => {
      this.stopRealtimeLipSync();
    });

    eventBus.on("tts:lipsync:update", (data) => {
      this.updateLipSync(data.rms);
    });

    eventBus.on("realtime:expression", (data) => {
      this.applyExpression(data.expressionId, "explicit");
    });

    eventBus.on("realtime:motion", (data) => {
      this.applyMotion(
        {
          group: data.group,
          index: data.index,
        },
        "explicit",
      );
    });

    eventBus.on("realtime:gaze", (data) => {
      this.applyGaze(data, "explicit");
    });

    eventBus.on("realtime:emotion", (data) => {
      this.handleRealtimeEmotion(data.emotion);
    });
  }

  /**
   * 메시지 콜백 설정
   */
  setMessageCallback(
    callback: (message: Message, character?: Character) => void,
  ): void {
    this.messageCallback = callback;
  }

  /**
   * 캐릭터 설정
   */
  setCharacter(character: Character): void {
    this.character = character;
  }

  /**
   * 렌더러 초기화
   */
  async initialize(): Promise<void> {
    await this.renderer.initialize();

    if (this.isMouseTrackable(this.renderer) && this.options?.canvas) {
      const mouseTrackableRenderer = this.renderer;
      this.cleanupMouseTracking = setupMouseTracking({
        canvas: this.options.canvas,
        mode: this.options.mouseTracking ?? "canvas",
        target: {
          updateViewWithMouse: (coords) => {
            if (this.isMouseTrackingSuspended()) {
              return;
            }

            mouseTrackableRenderer.updateViewWithMouse(coords);
          },
          handleMouseTap: (coords) => {
            if (this.isMouseTrackingSuspended()) {
              return;
            }

            mouseTrackableRenderer.handleMouseTap(coords);
          },
        },
      });
    }
  }

  /**
   * 모델 로드 (렌더러가 지원하는 경우)
   */
  async loadModel(modelPath: string): Promise<void> {
    if (this.renderer.loadModel) {
      await this.renderer.loadModel(modelPath);
    }
  }

  /**
   * 메시지 렌더링
   */
  async render(message: Message, character?: Character): Promise<void> {
    const targetCharacter = character || this.character || undefined;

    if (message.type === "character" && message.emotion && targetCharacter) {
      this.applyEmotionCompat(message.emotion, targetCharacter);
    }

    await this.renderer.render(message, targetCharacter);
    this.messageCallback?.(message, targetCharacter);
  }

  /**
   * 정리
   */
  async destroy(): Promise<void> {
    this.cleanupMouseTracking?.();
    this.cleanupMouseTracking = undefined;

    if (this.resumeMouseTrackingTimer) {
      clearTimeout(this.resumeMouseTrackingTimer);
      this.resumeMouseTrackingTimer = undefined;
    }

    this.lipSync.cleanup();
    await this.renderer.destroy();
  }

  /**
   * 실시간 립싱크 시작
   */
  private startRealtimeLipSync(audioElement?: HTMLAudioElement): void {
    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(true);
    }

    if (!audioElement) {
      return;
    }

    this.lipSync.connectToAudio(audioElement, (rms: number) => {
      if (this.renderer.updateRealtimeLipSyncRms) {
        this.renderer.updateRealtimeLipSyncRms(rms);
      }
    });
  }

  /**
   * 실시간 립싱크 중지
   */
  private stopRealtimeLipSync(): void {
    this.lipSync.stop();

    if (this.renderer.setRealtimeLipSync) {
      this.renderer.setRealtimeLipSync(false);
    }
  }

  /**
   * 립싱크 RMS 업데이트
   */
  private updateLipSync(rms: number): void {
    if (this.renderer.updateRealtimeLipSyncRms) {
      this.renderer.updateRealtimeLipSyncRms(rms);
    }
  }

  /**
   * Compat emotion 처리 (tool call로부터)
   */
  private handleRealtimeEmotion(emotion: Emotion): void {
    if (!this.character) {
      return;
    }

    this.applyEmotionCompat(emotion, this.character);
  }

  private applyEmotionCompat(emotion: Emotion, character: Character): void {
    if (Date.now() < this.explicitActionUntil) {
      return;
    }

    const preset = resolveEmotionPreset(character, emotion);
    if (!preset) {
      return;
    }

    this.applyAvatarPreset(preset, "compat");
  }

  private applyAvatarPreset(
    preset: AvatarActionPreset,
    source: ActionSource,
  ): void {
    if (preset.expression) {
      this.applyExpression(preset.expression, source);
    }

    if (preset.motion) {
      this.applyMotion(preset.motion, source);
    }
  }

  private applyExpression(expressionId: string, source: ActionSource): boolean {
    if (!this.hasExpressionControl(this.renderer)) {
      return false;
    }

    if (
      this.hasExpressionCatalog(this.renderer) &&
      !this.renderer.getAvailableExpressions().includes(expressionId)
    ) {
      return false;
    }

    const now = Date.now();
    if (
      this.lastExpression?.expressionId === expressionId &&
      now - this.lastExpression.at < EXPRESSION_DEBOUNCE_MS
    ) {
      return false;
    }

    this.renderer.playExpression(expressionId);
    this.lastExpression = { expressionId, at: now };
    this.markExplicitAction(source);
    return true;
  }

  private applyMotion(motion: MotionSelection, source: ActionSource): boolean {
    if (!this.hasMotionControl(this.renderer)) {
      return false;
    }

    const index = motion.index ?? 0;

    if (this.hasMotionCatalog(this.renderer)) {
      const motionGroups = this.renderer.getAvailableMotionGroups();
      const count = motionGroups[motion.group];

      if (typeof count !== "number" || index < 0 || index >= count) {
        return false;
      }
    }

    const now = Date.now();
    if (
      this.lastMotion?.group === motion.group &&
      this.lastMotion.index === index &&
      now - this.lastMotion.at < MOTION_DEBOUNCE_MS
    ) {
      return false;
    }

    this.renderer.playMotionByGroup(motion.group, index);
    this.lastMotion = { group: motion.group, index, at: now };
    this.markExplicitAction(source);
    return true;
  }

  private applyGaze(coords: GazeCoordinates, source: ActionSource): boolean {
    if (!this.hasGazeControl(this.renderer)) {
      return false;
    }

    this.renderer.lookAt(coords);

    if (source === "explicit") {
      this.markExplicitAction(source);
      this.suspendMouseTracking(EXPLICIT_ACTION_HOLD_MS);
    }

    return true;
  }

  private markExplicitAction(source: ActionSource): void {
    if (source !== "explicit") {
      return;
    }

    this.explicitActionUntil = Date.now() + EXPLICIT_ACTION_HOLD_MS;
  }

  private suspendMouseTracking(durationMs: number): void {
    this.mouseTrackingSuspendedUntil = Date.now() + durationMs;

    if (this.resumeMouseTrackingTimer) {
      clearTimeout(this.resumeMouseTrackingTimer);
    }

    this.resumeMouseTrackingTimer = setTimeout(() => {
      this.mouseTrackingSuspendedUntil = 0;
      this.resumeMouseTrackingTimer = undefined;
    }, durationMs);
  }

  private isMouseTrackingSuspended(): boolean {
    return Date.now() < this.mouseTrackingSuspendedUntil;
  }

  private isMouseTrackable(
    renderer: Renderer,
  ): renderer is Renderer & MouseTrackable {
    return (
      "updateViewWithMouse" in renderer &&
      typeof renderer.updateViewWithMouse === "function" &&
      "handleMouseTap" in renderer &&
      typeof renderer.handleMouseTap === "function"
    );
  }

  private hasExpressionControl(
    renderer: Renderer,
  ): renderer is Renderer & { playExpression(expressionId: string): void } {
    return (
      "playExpression" in renderer &&
      typeof renderer.playExpression === "function"
    );
  }

  private hasExpressionCatalog(
    renderer: Renderer,
  ): renderer is Renderer & { getAvailableExpressions(): string[] } {
    return (
      "getAvailableExpressions" in renderer &&
      typeof renderer.getAvailableExpressions === "function"
    );
  }

  private hasMotionControl(renderer: Renderer): renderer is Renderer & {
    playMotionByGroup(group: string, index: number): void;
  } {
    return (
      "playMotionByGroup" in renderer &&
      typeof renderer.playMotionByGroup === "function"
    );
  }

  private hasMotionCatalog(renderer: Renderer): renderer is Renderer & {
    getAvailableMotionGroups(): Record<string, number>;
  } {
    return (
      "getAvailableMotionGroups" in renderer &&
      typeof renderer.getAvailableMotionGroups === "function"
    );
  }

  private hasGazeControl(
    renderer: Renderer,
  ): renderer is Renderer & { lookAt(coords: GazeCoordinates): void } {
    return "lookAt" in renderer && typeof renderer.lookAt === "function";
  }
}

function resolveEmotionPreset(
  character: Character,
  emotion: Emotion,
): AvatarActionPreset | null {
  const mapping = character.emotionMappings?.find(
    (item) => item.emotion === emotion,
  );

  if (!mapping) {
    return null;
  }

  return {
    ...(mapping.expression ? { expression: mapping.expression } : {}),
    ...(mapping.motion ? { motion: mapping.motion } : {}),
  };
}

/**
 * Render Manager 생성 헬퍼 함수
 */
export function createRenderManager(
  renderer: Renderer,
  options?: RenderManagerOptions,
): RenderManager {
  return new RenderManager(renderer, options);
}
