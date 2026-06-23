import { STTTranscriber, STTOptions } from "@charivo/core";

type SpeechRecognitionHandler<TEvent extends Event> = (
  this: SpeechRecognition,
  ev: TEvent,
) => void;

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

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

  onresult: SpeechRecognitionHandler<SpeechRecognitionEvent> | null;
  onerror: SpeechRecognitionHandler<SpeechRecognitionErrorEvent> | null;
  onend: SpeechRecognitionHandler<Event> | null;
  onstart: SpeechRecognitionHandler<Event> | null;

  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Web STT Transcriber - STT Transcriber that uses the Web Speech API
 *
 * Uses the browser's built-in speech recognition
 * Converts speech to text in real time without recording
 *
 * Advantages:
 * - No API key required
 * - Free
 * - Real-time recognition
 * - No MediaRecorder required (listens to the microphone directly)
 *
 * Limitations:
 * - Requires browser support (Chrome, Edge, etc.)
 * - Requires an internet connection (in most browsers)
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
    const SpeechRecognitionAPI = getSpeechRecognitionConstructor();

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

    const SpeechRecognitionAPI = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionAPI) {
      throw new Error("Web Speech API is not supported in this browser");
    }

    this.recognition = new SpeechRecognitionAPI();
    this.recognition!.continuous = true; // Keep listening until stop() is called
    this.recognition!.interimResults = true;
    this.recognition!.maxAlternatives = 1;
    this.recognition!.lang = options?.language ?? "en-US";

    this.finalTranscript = "";

    return new Promise((resolve, reject) => {
      this.recognition!.onstart = () => {
        this.recording = true;
        resolve();
      };

      this.recognition!.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            this.finalTranscript += transcript + " ";
          }
        }
      };

      this.recognition!.onend = () => {
        this.recording = false;
        if (this.resolveTranscription) {
          this.resolveTranscription(this.finalTranscript.trim());
          this.resolveTranscription = undefined;
          this.rejectTranscription = undefined;
        }
      };

      this.recognition!.onerror = (event: SpeechRecognitionErrorEvent) => {
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

function getSpeechRecognitionConstructor():
  | SpeechRecognitionConstructor
  | undefined {
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}
