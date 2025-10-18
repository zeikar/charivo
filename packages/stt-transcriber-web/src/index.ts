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
 * Web STT Transcriber - STT Transcriber using Web Speech API
 *
 * Uses browser's built-in speech recognition
 * Stateless design: Real-time speech recognition processing
 *
 * Advantages:
 * - No API key required
 * - Free
 * - Real-time recognition
 *
 * Limitations:
 * - Browser support required (Chrome, Edge, etc.)
 * - Internet connection required (in most browsers)
 * - Language and accuracy depend on browser
 */
export class WebSTTTranscriber implements STTTranscriber {
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean;

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
   * Transcribe audio to text using Web Speech API
   *
   * Note: Web Speech API doesn't support direct audio blob transcription.
   * Instead, we'll use continuous recognition that listens to the microphone.
   * For blob-based transcription, consider using OpenAI or Remote transcriber.
   */
  async transcribe(
    _audio: Blob | ArrayBuffer,
    _options?: STTOptions,
  ): Promise<string> {
    if (!this.isSupported) {
      throw new Error(
        "Web Speech API is not supported in this browser. Please use a supported browser (Chrome, Edge, etc.) or switch to OpenAI/Remote transcriber.",
      );
    }

    // Web Speech API doesn't support blob transcription directly
    // This is a limitation of the browser API
    throw new Error(
      "WebSTTTranscriber doesn't support blob-based transcription. " +
        "Use startContinuous() for real-time recognition or switch to OpenAI/Remote transcriber for blob-based transcription.",
    );
  }

  /**
   * Start continuous speech recognition
   * Returns a promise that resolves with the final transcript
   *
   * @param options - STT options including language, continuous mode, etc.
   * @param onInterim - Callback for interim results (partial transcriptions)
   * @param onEnd - Callback when recognition ends
   */
  async startContinuous(
    options?: STTOptions & {
      continuous?: boolean;
      interimResults?: boolean;
      maxAlternatives?: number;
    },
    onInterim?: (transcript: string) => void,
    onEnd?: () => void,
  ): Promise<string> {
    if (!this.isSupported) {
      throw new Error("Web Speech API is not supported in this browser");
    }

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    return new Promise((resolve, reject) => {
      this.recognition = new SpeechRecognitionAPI();

      // Configure recognition
      this.recognition!.continuous = options?.continuous ?? false;
      this.recognition!.interimResults = options?.interimResults ?? true;
      this.recognition!.maxAlternatives = options?.maxAlternatives ?? 1;
      this.recognition!.lang = options?.language ?? "ko-KR";

      let finalTranscript = "";

      this.recognition!.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            finalTranscript += transcript + " ";
          } else {
            interimTranscript += transcript;
          }
        }

        // Call interim callback if provided
        if (onInterim && interimTranscript) {
          onInterim(interimTranscript);
        }
      };

      this.recognition!.onend = () => {
        onEnd?.();
        resolve(finalTranscript.trim());
      };

      this.recognition!.onerror = (event: SpeechRecognitionErrorEvent) => {
        reject(
          new Error(
            `Speech recognition error: ${event.error} - ${event.message}`,
          ),
        );
      };

      this.recognition!.start();
    });
  }

  /**
   * Stop continuous recognition
   */
  stopContinuous(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
  }

  /**
   * Abort continuous recognition immediately
   */
  abortContinuous(): void {
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }
  }

  /**
   * Check if Web Speech API is supported
   */
  isSupportedBrowser(): boolean {
    return this.isSupported;
  }
}

export function createWebSTTTranscriber(): WebSTTTranscriber {
  return new WebSTTTranscriber();
}
