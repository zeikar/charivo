import { RealtimeClient } from "@charivo/realtime-core";

/**
 * OpenAI Realtime API 이벤트 타입
 */
interface ServerEvent {
  type: string;
  [key: string]: any;
}

interface ClientEventOptions {
  apiEndpoint: string; // e.g., "/api/realtime"
  debug?: boolean; // Enable debug logging
}

/**
 * OpenAI Realtime API Client (WebRTC)
 *
 * WebRTC를 통해 OpenAI Realtime API와 통신합니다.
 * 서버의 unified interface를 사용하여 안전하게 연결합니다.
 *
 * 장점:
 * - API 키를 클라이언트에 노출하지 않음
 * - 오디오는 WebRTC가 자동 처리 (립싱크에 필요한 데이터만 추출)
 * - 이벤트는 DataChannel로 관리
 */
export class OpenAIRealtimeClient implements RealtimeClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private mediaStream: MediaStream | null = null;
  private apiEndpoint: string;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private lipSyncInterval: number | null = null;
  private isResponseInProgress = false;
  private debug: boolean;

  // 콜백 함수들
  private textDeltaCallback?: (text: string) => void;
  private audioDeltaCallback?: (base64Audio: string) => void;
  private lipSyncCallback?: (rms: number) => void; // Direct RMS callback
  private audioDoneCallback?: () => void;
  private toolCallCallback?: (name: string, args: any) => void;
  private errorCallback?: (error: Error) => void;

  constructor(options: ClientEventOptions) {
    this.apiEndpoint = options.apiEndpoint;
    this.debug = options.debug ?? false;
  }

  /**
   * Debug logging helper
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  /**
   * WebRTC 연결 시작
   */
  async connect(): Promise<void> {
    try {
      console.log("🔌 Starting WebRTC connection to Realtime API");

      // 1. Create RTCPeerConnection
      this.pc = new RTCPeerConnection();

      // 2. Set up audio playback (AI voice output)
      this.audioElement = document.createElement("audio");
      this.audioElement.autoplay = true;

      this.pc.ontrack = (e) => {
        console.log("🎵 Received audio track from OpenAI");
        if (this.audioElement) {
          this.audioElement.srcObject = e.streams[0];
        }

        // Set up audio analysis for lip sync
        this.setupAudioAnalysis(e.streams[0]);
      };

      // 3. Add local audio track (microphone input)
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const audioTrack = this.mediaStream.getTracks()[0];
        this.pc.addTrack(audioTrack, this.mediaStream);
        console.log("🎤 Added microphone track");
      } catch (error) {
        console.error("❌ Failed to get microphone access:", error);
        throw new Error("Microphone access required for Realtime API");
      }

      // 4. Set up data channel for events
      this.dc = this.pc.createDataChannel("oai-events");

      this.dc.onopen = () => {
        console.log("📡 DataChannel opened");
      };

      this.dc.onmessage = (e) => {
        const event = JSON.parse(e.data);
        this.handleServerEvent(event);
      };

      this.dc.onerror = (error) => {
        console.error("❌ DataChannel error:", error);
        this.errorCallback?.(new Error("DataChannel error"));
      };

      // 5. Create SDP offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      console.log("📤 Sending SDP offer to server");

      // 6. Send SDP offer to server (unified interface)
      const sdpResponse = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        throw new Error(`Failed to create Realtime session: ${errorText}`);
      }

      // 7. Set remote description (SDP answer from OpenAI)
      const sdpAnswer = await sdpResponse.text();
      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: sdpAnswer,
      };
      await this.pc.setRemoteDescription(answer);

      console.log("✅ WebRTC connection established");
    } catch (error) {
      console.error("❌ WebRTC connection error:", error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * WebRTC 연결 종료
   */
  async disconnect(): Promise<void> {
    console.log("🔌 Disconnecting WebRTC");
    this.cleanup();
  }

  /**
   * 텍스트 메시지 전송
   */
  async sendText(text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel not ready");
    }

    if (this.isResponseInProgress) {
      console.warn("⚠️ Response already in progress, skipping request");
      return;
    }

    // conversation.item.create
    const createEvent = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text,
          },
        ],
      },
    };

    this.dc.send(JSON.stringify(createEvent));

    // response.create
    const responseEvent = {
      type: "response.create",
    };

    this.dc.send(JSON.stringify(responseEvent));
    this.isResponseInProgress = true;

    console.log("📤 Sent text message:", text);
  }

  /**
   * 오디오 청크 전송
   *
   * Note: WebRTC는 마이크 오디오를 자동으로 전송하므로
   * 이 메서드는 사용되지 않을 수 있습니다.
   */
  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    // WebRTC는 자동으로 마이크 오디오를 전송
    console.warn(
      "sendAudio is not needed with WebRTC - audio is automatically transmitted",
    );
  }

  /**
   * 콜백 등록
   */
  onTextDelta(callback: (text: string) => void): void {
    this.textDeltaCallback = callback;
  }

  onAudioDelta(callback: (base64Audio: string) => void): void {
    this.audioDeltaCallback = callback;
  }

  onLipSyncUpdate(callback: (rms: number) => void): void {
    this.lipSyncCallback = callback;
  }

  onAudioDone(callback: () => void): void {
    this.audioDoneCallback = callback;
  }

  onToolCall(callback: (name: string, args: any) => void): void {
    this.toolCallCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * 서버 이벤트 처리
   */
  private handleServerEvent(event: ServerEvent): void {
    // Debug logging
    if (this.debug && !event.type.includes("audio.delta")) {
      this.log("📡 [Realtime Event]:", event.type, event);
    }

    switch (event.type) {
      case "session.created":
      case "session.updated":
        this.log("📡 Session:", event.type);
        break;

      case "response.audio.delta":
        // WebRTC에서는 오디오가 자동으로 재생되지만,
        // 립싱크를 위해 오디오 데이터를 콜백으로 전달
        if (event.delta) {
          this.audioDeltaCallback?.(event.delta);
        }
        break;

      case "response.audio.done":
        // 오디오 스트리밍 완료
        this.audioDoneCallback?.();
        break;

      case "response.done":
        // 응답 완료 - 새로운 요청 가능
        this.isResponseInProgress = false;
        this.log("✅ Response completed, ready for next request");
        break;

      case "response.audio_transcript.delta":
        // 텍스트 스트리밍 (AI 응답)
        if (event.delta) {
          this.textDeltaCallback?.(event.delta);
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
        // 사용자 음성 인식 완료
        this.log("🎤 User transcript:", event.transcript);
        break;

      case "response.function_call_arguments.done":
        // Tool call completed
        this.handleToolCallDone(event);
        break;

      case "error":
        console.error("❌ Realtime API error:", event.error);
        this.errorCallback?.(
          new Error(event.error?.message || "Unknown error"),
        );
        // 에러 발생 시에도 다음 요청을 허용
        this.isResponseInProgress = false;
        break;

      default:
        // 기타 이벤트는 로그만 출력
        if (
          this.debug &&
          (event.type.startsWith("response.") ||
            event.type.startsWith("conversation."))
        ) {
          this.log("📡 Event:", event.type);
        }
        break;
    }
  }

  /**
   * Tool call 완료 처리
   */
  private handleToolCallDone(event: ServerEvent): void {
    const callId =
      (event.call_id as string | undefined) ||
      (event.item?.call_id as string | undefined) ||
      (event.item_id as string | undefined);

    const name =
      (event.name as string | undefined) ||
      (event.item?.name as string | undefined);

    // arguments field contains the complete JSON string
    const argsJson =
      (event.arguments as string | undefined) ||
      (event.item?.arguments as string | undefined);

    this.log(
      "🔧 [Tool Done] callId:",
      callId,
      "name:",
      name,
      "argsJson:",
      argsJson,
    );

    if (!name || !argsJson) {
      console.warn("⚠️ Tool call done but missing name or arguments");
      return;
    }

    let args: any = {};
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.error("Failed to parse tool call args", e, argsJson);
      return;
    }

    this.log(`🔧 Tool call: ${name}`, args);
    this.toolCallCallback?.(name, args);

    // Send tool output back to OpenAI to continue the conversation
    if (callId && this.dc && this.dc.readyState === "open") {
      this.sendToolOutput(callId, { success: true });
    }
  }

  /**
   * Send tool output back to OpenAI
   */
  private sendToolOutput(callId: string, output: any): void {
    if (!this.dc || this.dc.readyState !== "open") {
      console.warn("⚠️ Cannot send tool output: DataChannel not ready");
      return;
    }

    const outputEvent = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    };

    this.dc.send(JSON.stringify(outputEvent));
    this.log("📤 Sent tool output for call:", callId);

    // Request a new response to continue the conversation
    const responseEvent = {
      type: "response.create",
    };

    this.dc.send(JSON.stringify(responseEvent));
    this.log("📤 Requested new response after tool call");
  }

  /**
   * 오디오 분석 설정 (립싱크용)
   */
  private setupAudioAnalysis(stream: MediaStream): void {
    try {
      // AudioContext 생성
      this.audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      // MediaStream → AudioContext
      const source = this.audioContext.createMediaStreamSource(stream);

      // AnalyserNode 생성
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect: source → analyser (not to destination, just analyze)
      source.connect(this.analyser);

      console.log("🎵 Audio analysis setup complete for lip sync");

      // Start analyzing audio for lip sync
      this.startLipSyncAnalysis();
    } catch (error) {
      console.error("Failed to setup audio analysis:", error);
    }
  }

  /**
   * 립싱크 분석 시작
   */
  private startLipSyncAnalysis(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // 60fps로 RMS 계산
    this.lipSyncInterval = window.setInterval(() => {
      if (!this.analyser) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate RMS from frequency data
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = dataArray[i] / 255; // Normalize to 0-1
        sum += normalized * normalized;
      }

      const rms = Math.sqrt(sum / bufferLength);

      // Amplify and clamp (similar to existing lip sync)
      const amplifiedRms = Math.min(rms * 3, 1.0);

      // Send RMS directly to lip sync callback
      if (this.lipSyncCallback) {
        this.lipSyncCallback(amplifiedRms);
      }
    }, 1000 / 60); // 60fps
  }

  /**
   * 립싱크 분석 중지
   */
  private stopLipSyncAnalysis(): void {
    if (this.lipSyncInterval) {
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
    }

    // Send final RMS 0 to close mouth
    if (this.lipSyncCallback) {
      this.lipSyncCallback(0);
    }
  }

  /**
   * 리소스 정리
   */
  private cleanup(): void {
    this.stopLipSyncAnalysis();

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioElement) {
      this.audioElement.srcObject = null;
      this.audioElement = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.isResponseInProgress = false;
  }
}

/**
 * OpenAI Realtime Client 생성 헬퍼 함수
 */
export function createOpenAIRealtimeClient(
  options: ClientEventOptions,
): RealtimeClient {
  return new OpenAIRealtimeClient(options);
}
