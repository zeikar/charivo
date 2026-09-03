import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  fetchWithTimeout,
  toCharivoError,
  type TTSOptions,
  type TTSProvider,
} from "@charivo/core";

// The request targets `models/{model}:generateContent`: it is the shape
// measured working and the simpler one-shot request for charivo's one
// utterance per call. Google labels it legacy but still fully supports it;
// only the private request builder below knows the endpoint.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_VOICE = "Kore";
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
// Google recommends a clear synthesis preamble marking where the transcript
// begins, so the request does not miss the model's speech classifier.
const PROMPT_PREAMBLE = "TTS the following text:\n";

const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const WAV_HEADER_BYTES = 44;

export interface GeminiTTSConfig {
  apiKey: string;
  defaultVoice?: string;
  defaultModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
  dangerouslyAllowBrowser?: boolean;
}

interface InlineAudio {
  mimeType: string;
  data: string;
}

/** A finished attempt: usable audio, or a failure worth one more attempt. */
type AttemptResult = { audio: ArrayBuffer } | { retry: CharivoProviderError };

/**
 * Server-side Gemini TTS over `models/{model}:generateContent`, returning WAV.
 *
 * `TTSOptions.rate` and `pitch` are ignored: Gemini TTS has no speed or pitch
 * parameter, and prompt-steered pacing is unreliable, so neither is mapped into
 * the prompt. The text is sent behind a fixed synthesis preamble, and the model
 * caps its input at 8,192 tokens.
 *
 * A 5xx or a text-only answer is retried once inside the same `timeoutMs`, not
 * a fresh one.
 *
 * Synthesis is not streamed: measured latency is ~0.55-0.7x the audio duration
 * (120 chars ~ 6s, 600 ~ 20s, 1,800 ~ 68s), which is why the default budget is
 * 90s. That default suits the direct player and callers that own their own
 * deadline; a route behind `@charivo/tts/remote` must pass a `timeoutMs` under
 * that player's fixed 30s (e.g. 25_000) so the server gives up first, and cap
 * its text length on top of that as the real latency control.
 */
export class GeminiTTSProvider implements TTSProvider {
  private apiKey: string;
  private baseUrl: string;
  private voice: string;
  private model: string;
  private timeoutMs: number;
  private timeoutMessage: string;

  constructor(config: GeminiTTSConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
        "Gemini TTS provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.voice = config.defaultVoice || DEFAULT_VOICE;
    this.model = config.defaultModel || DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    // Names the configured budget, not whatever is left of it on a retry.
    this.timeoutMessage = `Gemini TTS request timed out after ${this.timeoutMs}ms`;
  }

  setVoice(voice: string): void {
    this.voice = voice;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async generateSpeech(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: `${PROMPT_PREAMBLE}${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: options?.voice || this.voice },
          },
        },
      },
    });

    try {
      const deadline = Date.now() + this.timeoutMs;
      const first = await this.requestOnce(url, body, this.timeoutMs);

      if ("audio" in first) {
        return first.audio;
      }

      // One retry, sharing the original deadline so a caller's budget is never
      // doubled by it.
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // The first failure is the only diagnosis there is here, so it rides
        // along instead of being dropped for a bare "timed out".
        throw new CharivoTimeoutError(this.timeoutMessage, {
          cause: first.retry,
        });
      }

      const second = await this.requestOnce(url, body, remainingMs);
      if ("audio" in second) {
        return second.audio;
      }

      throw second.retry;
    } catch (error) {
      throw toCharivoError("provider", error, "Gemini TTS request failed");
    }
  }

  private requestOnce(
    url: string,
    body: string,
    timeoutMs: number,
  ): Promise<AttemptResult> {
    return fetchWithTimeout<AttemptResult>(
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
        timeoutMs,
        timeoutMessage: this.timeoutMessage,
        // DNS/TLS/connection failures land here as raw fetch errors — map them
        // so every failure escaping this provider is a CharivoError.
        mapError: (error) =>
          toCharivoError("provider", error, "Gemini TTS request failed"),
      },
      // Consumed inside the helper so the timeout also covers downloading and
      // parsing the body, which carries the whole audio clip.
      async (response) => {
        // Google documents two failure modes for this model — an occasional
        // 500, and text tokens where audio was asked for — and recommends
        // retrying automatically. 4xx answers and network failures are the
        // caller's problem and are not retried.
        if (response.status >= 500) {
          return {
            retry: new CharivoProviderError(
              `Gemini TTS Error: ${await readResponseText(response)}`,
            ),
          };
        }

        if (!response.ok) {
          throw new CharivoProviderError(
            `Gemini TTS Error: ${await readResponseText(response)}`,
          );
        }

        const inlineData = extractInlineAudio(await readResponseJson(response));

        if (!inlineData) {
          return {
            retry: new CharivoProviderError(
              "Gemini TTS Error: response contained no audio",
            ),
          };
        }

        const { sampleRate, channels } = parseL16MimeType(inlineData.mimeType);

        return {
          audio: toWavBuffer(
            decodeBase64(inlineData.data),
            sampleRate,
            channels,
          ),
        };
      },
    );
  }
}

export function createGeminiTTSProvider(
  config: GeminiTTSConfig,
): GeminiTTSProvider {
  return new GeminiTTSProvider(config);
}

function extractInlineAudio(payload: unknown): InlineAudio | null {
  if (!isRecord(payload)) {
    return null;
  }

  const candidate = Array.isArray(payload.candidates)
    ? payload.candidates[0]
    : undefined;
  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    return null;
  }

  // The first part carrying inlineData, not parts[0]: the model sometimes
  // prefixes the audio with a text part, and that answer is usable.
  const parts = Array.isArray(candidate.content.parts)
    ? candidate.content.parts
    : [];
  const part = parts.find(
    (entry) => isRecord(entry) && isRecord(entry.inlineData),
  );
  if (!isRecord(part) || !isRecord(part.inlineData)) {
    return null;
  }

  const { mimeType, data } = part.inlineData;

  return typeof mimeType === "string" && typeof data === "string"
    ? { mimeType, data }
    : null;
}

/** Reads the `rate` / `channels` parameters off `audio/l16; rate=…; channels=…`. */
function parseL16MimeType(mimeType: string): {
  sampleRate: number;
  channels: number;
} {
  const [mediaType, ...parameters] = mimeType.split(";");

  // Media types and parameter names are case-insensitive.
  if (mediaType?.trim().toLowerCase() !== "audio/l16") {
    throw new CharivoProviderError(
      `Gemini TTS Error: unsupported audio format "${mimeType}"`,
    );
  }

  let sampleRate = DEFAULT_SAMPLE_RATE;
  let channels = DEFAULT_CHANNELS;

  for (const parameter of parameters) {
    const [rawName, rawValue] = parameter.split("=");
    const name = rawName?.trim().toLowerCase();
    const value = Number(rawValue?.trim());

    if (!Number.isInteger(value) || value <= 0) {
      continue;
    }

    if (name === "rate") {
      sampleRate = value;
    } else if (name === "channels") {
      channels = value;
    }
  }

  return { sampleRate, channels };
}

/** `atob` is a global in browsers and in Node >= 16, so one path serves both. */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/** Gemini returns headerless PCM; players need a container. */
function toWavBuffer(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number,
): ArrayBuffer {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + pcm.length);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + pcm.length, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length, true);
  new Uint8Array(buffer, WAV_HEADER_BYTES).set(pcm);

  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
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
      "Failed to read Gemini TTS response body",
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
      "Failed to parse Gemini TTS response body",
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
