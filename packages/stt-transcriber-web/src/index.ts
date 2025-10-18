import { STTTranscriber, STTOptions } from "@charivo/core";

// Web Speech API type definitions
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;

  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any)
    | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;

  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Web STT Transcriber - Web Speech API를 사용하는 STT Transcriber
 *
 * 브라우저 내장 음성 인식 기능을 사용
 * 녹음 없이 실시간으로 음성을 텍스트로 변환
 *
 * 장점:
 * - API 키 불필요
 * - 무료
 * - 실시간 인식
 * - MediaRecorder 불필요 (마이크 직접 청취)
 *
 * 제약사항:
 * - 브라우저 지원 필요 (Chrome, Edge 등)
 * - 인터넷 연결 필요 (대부분의 브라우저에서)
 */
export class WebSTTTranscriber implements STTTranscriber {
  private recognition: SpeechRecognition | null = null;
  private recording = false;
  private isSupported: boolean;
  private resolveTranscription?: (text: string) => void;
  private rejectTranscription?: (error: Error) => void;
  private finalTranscript = "";

  constructor() {
    // Check browser support
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    this.isSupported = !!SpeechRecognitionAPI;

    if (!this.isSupported) {
      console.warn(
        "Web Speech API is not supported in this browser. STT functionality will be limited.",
      );
    }
  }

  /**
   * Start real-time speech recognition
   */
  async startRecording(options?: STTOptions): Promise<void> {
    if (!this.isSupported) {
      throw new Error(
        "Web Speech API is not supported in this browser. Please use a supported browser (Chrome, Edge, etc.) or switch to OpenAI/Remote transcriber.",
      );
    }

    if (this.recording) {
      throw new Error("Already recording");
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognitionAPI();
    this.recognition!.continuous = true; // Keep listening until stop() is called
    this.recognition!.interimResults = true;
    this.recognition!.maxAlternatives = 1;
    this.recognition!.lang = options?.language ?? "en-US";

    this.finalTranscript = "";

    return new Promise((resolve, reject) => {
      this.recognition!.onstart = () => {
        console.log("🎤 Web Speech API started (continuous mode)");
        this.recording = true;
        resolve();
      };

      this.recognition!.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            this.finalTranscript += transcript + " ";
            console.log("🎤 Final segment added:", transcript);
          } else {
            interimTranscript += transcript;
          }
        }
        if (interimTranscript) {
          console.log(
            "🎤 Interim:",
            interimTranscript,
            "| Total final:",
            this.finalTranscript.trim(),
          );
        }
      };

      this.recognition!.onend = () => {
        console.log(
          "🎤 Web Speech API ended. Final transcript:",
          this.finalTranscript.trim(),
        );
        this.recording = false;
        if (this.resolveTranscription) {
          this.resolveTranscription(this.finalTranscript.trim());
          this.resolveTranscription = undefined;
          this.rejectTranscription = undefined;
        }
      };

      this.recognition!.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("🎤 Web Speech API error:", event.error, event.message);
        this.recording = false;
        const error = new Error(
          `Speech recognition error: ${event.error}${event.message ? " - " + event.message : ""}`,
        );
        if (this.rejectTranscription) {
          this.rejectTranscription(error);
          this.resolveTranscription = undefined;
          this.rejectTranscription = undefined;
        }
        reject(error);
      };

      try {
        this.recognition!.start();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop speech recognition and return transcription
   */
  async stopRecording(): Promise<string> {
    if (!this.recording || !this.recognition) {
      throw new Error("Not recording");
    }

    return new Promise((resolve, reject) => {
      this.resolveTranscription = resolve;
      this.rejectTranscription = reject;
      this.recognition!.stop();
    });
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Check if Web Speech API is supported in this browser
   */
  isSupportedBrowser(): boolean {
    return this.isSupported;
  }
}

export function createWebSTTTranscriber(): WebSTTTranscriber {
  return new WebSTTTranscriber();
}
