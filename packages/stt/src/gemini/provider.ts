import {
  CharivoProviderError,
  CharivoStateError,
  fetchWithTimeout,
  toCharivoError,
  type STTOptions,
  type STTProvider,
} from "@charivo/core";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-3.5-transcribe";
// Matches OpenAISTTProvider's REQUEST_TIMEOUT_MS and the fixed
// DEFAULT_FETCH_TIMEOUT_MS of `@charivo/stt/remote`: the server budget is never
// longer than the browser's. A route that must give up first passes a smaller
// timeoutMs, the way the Gemini TTS route does.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const FALLBACK_MIME_TYPE = "audio/wav";

// String.fromCharCode takes the slice as arguments, and a whole recording at
// once overruns the argument-count limit.
const BASE64_CHUNK_BYTES = 0x8000;

export interface GeminiSTTConfig {
  apiKey: string;
  defaultModel?: string;
  defaultLanguage?: string;
  baseUrl?: string;
  timeoutMs?: number;
  dangerouslyAllowBrowser?: boolean;
}

/**
 * Server-side Gemini STT over `models/{model}:generateContent`.
 *
 * The audio is posted inline as base64, which Google caps at 20MB per request:
 * callers bound the upload before calling, the way the demo's
 * `STT_MAX_AUDIO_BYTES` does.
 *
 * `STTOptions.language` is optional and only a soft hint — the model
 * transcribes what it hears even when the hint is wrong.
 *
 * One request per utterance, with no streaming: the live transcription model
 * (`gemini-3.5-transcribe-live`) is WebSocket-only, `generateContent` rejects
 * it with a 400, and it is served by `@charivo/stt/gemini-live`. Measured
 * latency is 1.5-3.4s on a 4s clip.
 *
 * The free tier allows 3 requests per minute; beyond that the 429 surfaces as a
 * CharivoProviderError carrying Google's retry hint.
 */
export class GeminiSTTProvider implements STTProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultLanguage?: string;
  private timeoutMs: number;
  private timeoutMessage: string;

  constructor(config: GeminiSTTConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
        "Gemini STT provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.model = config.defaultModel || DEFAULT_MODEL;
    this.defaultLanguage = config.defaultLanguage;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.timeoutMessage = `Gemini STT request timed out after ${this.timeoutMs}ms`;
  }

  async transcribe(
    audio: Blob | ArrayBuffer,
    options?: STTOptions,
  ): Promise<string> {
    const bytes =
      audio instanceof Blob
        ? new Uint8Array(await audio.arrayBuffer())
        : new Uint8Array(audio);
    // MediaRecorderHelper records audio/webm, which the model accepts as sent.
    // The ArrayBuffer path has no type to carry, so it keeps
    // OpenAISTTProvider's WAV assumption.
    const mimeType =
      audio instanceof Blob && audio.type ? audio.type : FALLBACK_MIME_TYPE;
    const language = options?.language || this.defaultLanguage;

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`;
    // No prompt part: audio alone transcribes, and a prompt changes nothing.
    // The language hint is passed through as given — `en` and `en-US` are both
    // accepted, and it only nudges the model. Never `transcriptionConfig` (the
    // Interactions-API name, rejected with 400 "Unknown name") nor
    // `thinkingConfig` (thinking is not enabled for this model).
    const body = JSON.stringify({
      contents: [
        { parts: [{ inlineData: { mimeType, data: encodeBase64(bytes) } }] },
      ],
      ...(language
        ? {
            generationConfig: {
              audioTranscriptionConfig: { languageCodes: [language] },
            },
          }
        : {}),
    });

    try {
      return await fetchWithTimeout<string>(
        url,
        {
          method: "POST",
          headers: {
            // Never in the URL: proxies and request logs capture query strings.
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body,
        },
        {
          timeoutMs: this.timeoutMs,
          timeoutMessage: this.timeoutMessage,
          // DNS/TLS/connection failures land here as raw fetch errors — map
          // them so every failure escaping this provider is a CharivoError.
          mapError: (error) =>
            toCharivoError("provider", error, "Gemini STT request failed"),
        },
        // Consumed inside the helper so the timeout also covers downloading and
        // parsing the body.
        async (response) => {
          if (!response.ok) {
            // 400 for audio the model cannot decode, 429 with Google's retry
            // hint on the free tier; nothing is retried here.
            throw new CharivoProviderError(
              `Gemini STT Error: ${await readResponseText(response)}`,
            );
          }

          return extractTranscript(await readResponseJson(response));
        },
      );
    } catch (error) {
      throw toCharivoError("provider", error, "Gemini STT request failed");
    }
  }
}

export function createGeminiSTTProvider(
  config: GeminiSTTConfig,
): GeminiSTTProvider {
  return new GeminiSTTProvider(config);
}

function extractTranscript(payload: unknown): string {
  const candidates =
    isRecord(payload) && Array.isArray(payload.candidates)
      ? payload.candidates
      : [];
  const candidate = candidates[0];

  // A blocked input answers with promptFeedback and no candidates at all:
  // that is a refusal, not silence, so it must not read as an empty utterance.
  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    throw new CharivoProviderError(
      "Gemini STT Error: response contained no transcription",
    );
  }

  // Silence answers with `content: {}` — the one measured shape that really
  // means "nothing was said".
  if (
    !Array.isArray(candidate.content.parts) ||
    candidate.content.parts.length === 0
  ) {
    return "";
  }

  // audioTranscription is its own part type, not `text`, and a text part can
  // precede it. Every transcription part is joined because a segmented answer
  // spreads one utterance across several of them, and returning only the first
  // would truncate it into a plausible-looking partial transcript.
  const texts: string[] = [];
  for (const part of candidate.content.parts) {
    if (isRecord(part) && isRecord(part.audioTranscription)) {
      const { text } = part.audioTranscription;
      if (typeof text === "string") {
        texts.push(text);
      }
    }
  }

  if (texts.length > 0) {
    return texts.join("");
  }

  throw new CharivoProviderError(
    "Gemini STT Error: response contained no transcription",
  );
}

/** `btoa` is a global in browsers and in Node >= 16, so one path serves both. */
function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES)),
    );
  }

  return btoa(chunks.join(""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Duplicated with the other Gemini providers' readers rather than shared:
// strict layering keeps each provider self-contained, with no cross-package
// helper module between them.
async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    // Re-thrown unchanged so fetchWithTimeout's own abort classification
    // (still watching this in-flight body read) can tell a body-phase
    // timeout from a genuine parse failure; wrapping it here would turn
    // every large-response timeout into a CharivoProviderError.
    if (isAbortError(error)) {
      throw error;
    }
    throw toCharivoError(
      "provider",
      error,
      "Failed to read Gemini STT response body",
    );
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw toCharivoError(
      "provider",
      error,
      "Failed to parse Gemini STT response body",
    );
  }
}

// Mirrors fetchWithTimeout's own check: only that helper decides whether an
// abort came from its timeout or an external signal, so the readers must
// recognize the same shape of error to hand it back unclassified.
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
