import {
  subscribeBrowserLifecycle,
  type Character,
  type EventMap,
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

const GAZE_MOUSE_SUSPEND_MS = 1_200;
const LOCAL_GAZE_SUSPEND_MS = 700;
const EXPRESSION_DEBOUNCE_MS = 300;
const MOTION_DEBOUNCE_MS = 1_000;

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
  private teardownBrowserLifecycle?: () => void;
  private messageCallback?: (message: Message, character?: Character) => void;
  private cleanupMouseTracking?: MouseTrackingCleanup;
  private resumeMouseTrackingTimer?: ReturnType<typeof setTimeout>;
  private mouseTrackingSuspendedUntil = 0;
  private localGazeSuspendUntil = 0;
  private lastExpression?: { expressionId: string; at: number };
  private lastMotion?: { group: string; index: number; at: number };
  private eventBus?: CharivoEventBus;

  // Stable handler references so they can be removed by reference in disconnect()
  private readonly handleTtsAudioStart = (
    data: EventMap["tts:audio:start"],
  ): void => {
    this.startRealtimeLipSync(data.audioElement);
  };

  private readonly handleTtsAudioEnd = (
    _data: EventMap["tts:audio:end"],
  ): void => {
    this.stopRealtimeLipSync();
  };

  private readonly handleTtsLipsyncUpdate = (
    data: EventMap["tts:lipsync:update"],
  ): void => {
    this.updateLipSync(data.rms);
  };

  private readonly handleRealtimeExpression = (
    data: EventMap["realtime:expression"],
  ): void => {
    this.applyExpression(data.expressionId);
  };

  private readonly handleRealtimeMotion = (
    data: EventMap["realtime:motion"],
  ): void => {
    this.applyMotion({ group: data.group, index: data.index });
  };

  private readonly handleRealtimeGaze = (
    data: EventMap["realtime:gaze"],
  ): void => {
    this.applyGaze(data);
  };

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
    // Defensive self-clear: avoid double-registering if called again
    if (this.eventBus) {
      this.disconnect();
    }

    this.eventBus = eventBus;
    eventBus.on("tts:audio:start", this.handleTtsAudioStart);
    eventBus.on("tts:audio:end", this.handleTtsAudioEnd);
    eventBus.on("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    eventBus.on("realtime:expression", this.handleRealtimeExpression);
    eventBus.on("realtime:motion", this.handleRealtimeMotion);
    eventBus.on("realtime:gaze", this.handleRealtimeGaze);
  }

  /**
   * 이벤트 버스 리스너 제거. 연결된 버스가 없으면 아무것도 하지 않으며 여러 번 호출해도 안전합니다.
   */
  disconnect(): void {
    if (!this.eventBus) {
      return;
    }

    // Stop any in-progress lip-sync before removing listeners so the RMS
    // callback cannot fire into the renderer after the bus is cleared.
    this.stopRealtimeLipSync();

    this.eventBus.off("tts:audio:start", this.handleTtsAudioStart);
    this.eventBus.off("tts:audio:end", this.handleTtsAudioEnd);
    this.eventBus.off("tts:lipsync:update", this.handleTtsLipsyncUpdate);
    this.eventBus.off("realtime:expression", this.handleRealtimeExpression);
    this.eventBus.off("realtime:motion", this.handleRealtimeMotion);
    this.eventBus.off("realtime:gaze", this.handleRealtimeGaze);
    this.eventBus = undefined;
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
    this.bindBrowserLifecycleEvents();
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
            if (this.isAiGazeActive()) {
              return;
            }

            mouseTrackableRenderer.handleMouseTap(coords);
          },
        },
      });
    }
  }

  async prepareAudio(): Promise<void> {
    await this.lipSync.prepareAudio();
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

    await this.renderer.render(message, targetCharacter);
    this.messageCallback?.(message, targetCharacter);
  }

  /** Local-presence gaze (webcam), a peer of mouse-tracking. Yields to the AI
   *  gaze window (isAiGazeActive); while applying, suspends mouse CURSOR tracking
   *  (updateViewWithMouse, NOT taps) via a separate local-gaze window so the
   *  static document mouse cursor target does not fight the webcam. Returns true
   *  when applied, false on no-op (AI owns the avatar, or the renderer has no lookAt). */
  setLocalGaze(coords: GazeCoordinates): boolean {
    if (this.isAiGazeActive()) return false; // yield to AI gaze ONLY
    if (!this.hasGazeControl(this.renderer)) return false;
    this.renderer.lookAt(coords);
    this.localGazeSuspendUntil = Date.now() + LOCAL_GAZE_SUSPEND_MS; // beat mouse
    return true;
  }

  /**
   * 정리
   */
  async destroy(): Promise<void> {
    this.disconnect();
    this.unbindBrowserLifecycleEvents();
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

  private bindBrowserLifecycleEvents(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: this.handleHidden,
      onPageHide: this.handlePageHide,
      onPageShow: this.handlePageShow,
      onVisible: this.handleVisible,
    });
  }

  private unbindBrowserLifecycleEvents(): void {
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
  }

  private readonly handleHidden = (): void => {
    this.lipSync.pause();
  };

  private readonly handleVisible = (): void => {
    this.lipSync.resume();
  };

  private readonly handlePageHide = (): void => {
    this.lipSync.pause();
  };

  private readonly handlePageShow = (): void => {
    this.lipSync.resume();
  };

  private applyExpression(expressionId: string): boolean {
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
    return true;
  }

  private applyMotion(motion: MotionSelection): boolean {
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
    return true;
  }

  private applyGaze(coords: GazeCoordinates): boolean {
    if (!this.hasGazeControl(this.renderer)) {
      return false;
    }

    this.renderer.lookAt(coords);
    this.suspendMouseTracking(GAZE_MOUSE_SUSPEND_MS);

    return true;
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

  private isAiGazeActive(): boolean {
    return Date.now() < this.mouseTrackingSuspendedUntil;
  }

  private isMouseTrackingSuspended(): boolean {
    return this.isAiGazeActive() || Date.now() < this.localGazeSuspendUntil;
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

/**
 * Render Manager 생성 헬퍼 함수
 */
export function createRenderManager(
  renderer: Renderer,
  options?: RenderManagerOptions,
): RenderManager {
  return new RenderManager(renderer, options);
}
