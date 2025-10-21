import {
  RealtimeClient,
  RealtimeManager as IRealtimeManager,
  RealtimeSessionConfig,
} from "./types";

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
export class RealtimeManagerImpl implements IRealtimeManager {
  private client: RealtimeClient;
  private eventEmitter?: { emit: (event: string, data: any) => void };
  private isSessionActive = false;

  constructor(client: RealtimeClient) {
    this.client = client;
    this.setupClientListeners();
  }

  /**
   * 이벤트 발신자 설정
   */
  setEventEmitter(eventEmitter: {
    emit: (event: string, data: any) => void;
  }): void {
    this.eventEmitter = eventEmitter;
    console.log("🔗 Realtime Manager: Event emitter connected");
  }

  /**
   * Realtime 세션 시작
   */
  async startSession(config: RealtimeSessionConfig): Promise<void> {
    if (this.isSessionActive) {
      throw new Error("Realtime session already active");
    }

    console.log("🚀 Starting Realtime session with config:", config);

    // 클라이언트 연결
    await this.client.connect();

    this.isSessionActive = true;

    console.log("✅ Realtime session started");
  }

  /**
   * Realtime 세션 종료
   */
  async stopSession(): Promise<void> {
    if (!this.isSessionActive) return;

    console.log("🛑 Stopping Realtime session");

    // 클라이언트 연결 해제
    await this.client.disconnect();

    this.isSessionActive = false;

    console.log("✅ Realtime session stopped");
  }

  /**
   * 텍스트 메시지 전송
   */
  async sendMessage(text: string): Promise<void> {
    if (!this.isSessionActive) {
      throw new Error("Realtime session not active");
    }

    await this.client.sendText(text);
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
        this.eventEmitter?.emit("tts:lipsync:update", { rms });
      });
    }

    // 오디오 스트리밍 종료
    this.client.onAudioDone(() => {
      // 립싱크 종료 (입 닫기)
      this.eventEmitter?.emit("tts:lipsync:update", { rms: 0 });
      this.eventEmitter?.emit("tts:audio:end", {});
    });

    // 에러 처리
    this.client.onError((error: Error) => {
      console.error("Realtime client error:", error);
      this.eventEmitter?.emit("realtime:error", { error });
    });
  }
}

/**
 * Realtime Manager 생성 헬퍼 함수
 */
export function createRealtimeManager(
  client: RealtimeClient,
): IRealtimeManager {
  return new RealtimeManagerImpl(client);
}
