import {
  CharivoProviderError,
  CharivoTimeoutError,
  CharivoTransportError,
  type TTSPlayer,
  TTSOptions,
} from "@charivo/core";

export interface RemoteTTSConfig {
  apiEndpoint?: string;
  defaultVoice?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Remote TTS Player - Stateless TTS Player that uses a remote server's TTS API
 *
 * Processes TTS on the server and receives the audio data
 * Stateless design: audio playback and lip-sync are handled by the TTS Manager
 */
class RemoteTTSPlayer implements TTSPlayer {
  readonly playbackMode = "audio" as const;
  readonly audioMimeType = "audio/wav";
  private apiEndpoint: string;
  private defaultVoice: string;

  constructor(config: RemoteTTSConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/tts";
    this.defaultVoice = config.defaultVoice || "marin";
  }

  /**
   * Stateless audio generation (used by the TTS Manager)
   */
  async generateAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    const response = await fetchWithTimeout(
      this.apiEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: options?.voice || this.defaultVoice,
          speed: options?.rate || 1.0,
          format: "wav",
        }),
      },
      `TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      throw new CharivoProviderError(`TTS API failed: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Legacy speak method (kept for compatibility)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Perform simple playback only (no lip-sync)
    const audioBuffer = await this.generateAudio(text, options);
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);

      if (options?.volume !== undefined) {
        audio.volume = Math.max(0, Math.min(1, options.volume));
      }

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };

      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        reject(new CharivoTransportError("Audio playback failed"));
      };

      audio.play().catch(reject);
    });
  }

  async stop(): Promise<void> {
    // Stateless, so no special cleanup is needed
  }

  setVoice(voice: string): void {
    this.defaultVoice = voice;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && typeof fetch !== "undefined";
  }
}

export function createRemoteTTSPlayer(config?: RemoteTTSConfig): TTSPlayer {
  return new RemoteTTSPlayer(config);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new CharivoTimeoutError(timeoutMessage, { cause: error });
    }
    throw new CharivoTransportError("TTS request failed", {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
