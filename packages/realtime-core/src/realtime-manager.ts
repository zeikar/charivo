import {
  CharivoEventEmitter,
  RealtimeManager as CoreRealtimeManager,
  RealtimeSessionConfig,
  RealtimeClient,
} from "./types";
import { Emotion } from "@charivo/core";

/**
 * Realtime Manager - Realtime API 세션 관리
 *
 * 역할:
 * - Realtime 클라이언트 관리 (WebRTC)
 * - 립싱크 이벤트 중계
 * - 텍스트 스트리밍 처리
 *
 * Note: WebRTC 클라이언트는 오디오를 자동으로 처리하므로
 * 이 Manager는 이벤트 중계에 집중합니다.
 */
export class RealtimeManagerImpl implements CoreRealtimeManager {
  private client: RealtimeClient;
  private eventEmitter?: CharivoEventEmitter;
  private isSessionActive = false;
  private isAudioPlaybackActive = false;

  constructor(client: RealtimeClient) {
    this.client = client;
    this.setupClientListeners();
  }

  /**
   * 이벤트 발신자 설정
   */
  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Realtime 세션 시작
   */
  async startSession(config: RealtimeSessionConfig): Promise<void> {
    if (this.isSessionActive) {
      throw new Error("Realtime session already active");
    }

    // 클라이언트 연결
    await this.client.connect(config);

    this.isSessionActive = true;
  }

  /**
   * Realtime 세션 종료
   */
  async stopSession(): Promise<void> {
    if (!this.isSessionActive) return;

    // 클라이언트 연결 해제
    await this.client.disconnect();
    this.emitAudioEnd();

    this.isSessionActive = false;
  }

  /**
   * 텍스트 메시지 전송
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.isSessionActive) {
      throw new Error("Realtime session not active");
    }

    this.emitAudioStart();
    try {
      await this.client.sendText(text);
    } catch (error) {
      this.emitAudioEnd();
      throw error;
    }
  }

  /**
   * 오디오 청크 전송 (사용자 음성)
   */
  async sendAudioChunk(audio: ArrayBuffer): Promise<void> {
    if (!this.isSessionActive) {
      throw new Error("Realtime session not active");
    }

    await this.client.sendAudio(audio);
  }

  /**
   * 클라이언트 이벤트 리스너 설정
   */
  private setupClientListeners(): void {
    // 텍스트 스트리밍
    this.client.onTextDelta((text: string) => {
      this.eventEmitter?.emit("realtime:text:delta", { text });
    });

    // Direct RMS callback (for WebRTC clients)
    if (this.client.onLipSyncUpdate) {
      this.client.onLipSyncUpdate((rms: number) => {
        if (rms > 0.001 && !this.isAudioPlaybackActive) {
          this.emitAudioStart();
        }
        this.eventEmitter?.emit("tts:lipsync:update", { rms });
      });
    }

    // 오디오 스트리밍 종료
    this.client.onAudioDone(() => {
      this.emitAudioEnd();
    });

    // Tool call 처리
    if (this.client.onToolCall) {
      this.client.onToolCall((name: string, args: Record<string, unknown>) => {
        this.handleToolCall(name, args);
      });
    }

    // 에러 처리
    this.client.onError((error: Error) => {
      this.emitAudioEnd();
      this.eventEmitter?.emit("realtime:error", { error });
    });
  }

  /**
   * Tool call 처리
   */
  private handleToolCall(name: string, args: Record<string, unknown>): void {
    const emotion = args.emotion;

    if (name === "setEmotion" && typeof emotion === "string") {
      this.eventEmitter?.emit("realtime:emotion", {
        emotion: emotion as Emotion,
      });
    }
  }

  private emitAudioStart(): void {
    if (this.isAudioPlaybackActive) {
      return;
    }
    this.isAudioPlaybackActive = true;
    this.eventEmitter?.emit("tts:audio:start", {});
  }

  private emitAudioEnd(): void {
    if (!this.isAudioPlaybackActive) {
      return;
    }
    this.isAudioPlaybackActive = false;
    this.eventEmitter?.emit("tts:lipsync:update", { rms: 0 });
    this.eventEmitter?.emit("tts:audio:end", {});
  }
}

/**
 * Realtime Manager 생성 헬퍼 함수
 */
export function createRealtimeManager(
  client: RealtimeClient,
): CoreRealtimeManager {
  return new RealtimeManagerImpl(client);
}
