import {
  CharivoProviderError,
  CharivoStateError,
  CharivoTimeoutError,
  fetchWithTimeout,
  toCharivoError,
  type TTSOptions,
  type TTSPcmStream,
  type TTSProvider,
} from "@charivo/core";

// Requests target `models/{model}:generateContent`, or its
// `:streamGenerateContent?alt=sse` twin for the streaming method: the shapes
// measured working, and the simpler one-shot requests for charivo's one
// utterance per call. Google labels them legacy but still fully supports them;
// only the two methods below know their endpoints.
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

// SSE frames are separated by a blank line, and CRLF is as valid as LF.
const SSE_FRAME_SEPARATOR = /\r?\n\r?\n/;
const SSE_LINE_SEPARATOR = /\r?\n/;
const SSE_DATA_PREFIX = "data:";

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

/** The same, for a streaming attempt: an open stream, or one more attempt. */
type StreamAttemptResult =
  | { stream: TTSPcmStream }
  | { retry: CharivoProviderError };

/** One SSE event: audio, a terminator, or both. */
interface StreamEvent {
  audio: InlineAudio | null;
  finishReason: string | null;
}

/** The stream handed to the caller, once the first audio event created it. */
interface OpenStream {
  controller: ReadableStreamDefaultController<Uint8Array>;
  /** Pinned by that first event: its format is already with the caller. */
  mimeType: string;
  result: { stream: TTSPcmStream };
}

/**
 * Server-side Gemini TTS over `models/{model}:generateContent`, returning WAV,
 * with `generateSpeechStream` over `:streamGenerateContent?alt=sse` handing
 * back raw PCM as it is synthesized.
 *
 * `TTSOptions.rate` and `pitch` are ignored: Gemini TTS has no speed or pitch
 * parameter, and prompt-steered pacing is unreliable, so neither is mapped into
 * the prompt. The text is sent behind a fixed synthesis preamble, and the model
 * caps its input at 8,192 tokens.
 *
 * A 5xx or an answer carrying no audio is retried once inside the same
 * `timeoutMs`, not a fresh one.
 *
 * `generateSpeech` does not stream: measured latency is a fixed startup cost
 * plus ~0.75x the audio duration (56 chars ~ 3s, 120 ~ 6s, 600 ~ 20s, 1,800 ~
 * 68s), so a short reply does not get proportionally cheaper. The long end is
 * why the default budget is 90s. That default suits the direct player and
 * callers that own their own deadline; a route behind `@charivo/tts/remote`
 * must pass a `timeoutMs` under that player's fixed 30s (e.g. 25_000) so the
 * server gives up first, and cap its text length on top of that as the real
 * latency control.
 *
 * `generateSpeechStream` hands back the first audio in ~1.1-1.4s whatever the
 * text length, and then delivers ~3.5x faster than realtime. It pays for that
 * in completeness: a long text is truncated under a 200 and terminated with a
 * non-`STOP` finish reason (measured: 2,358 chars ended `SAFETY` where 1,182
 * completed), so any terminator but `STOP` is a failed stream. Nothing is
 * retried once the first chunk has been handed out — a retry would replay
 * speech the caller has already played.
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
    const body = this.buildRequestBody(text, options?.voice || this.voice);

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

  async generateSpeechStream(
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ): Promise<TTSPcmStream> {
    const url = `${this.baseUrl}/v1beta/models/${this.model}:streamGenerateContent?alt=sse`;
    const body = this.buildRequestBody(text, options?.voice || this.voice);

    try {
      const deadline = Date.now() + this.timeoutMs;
      const first = await this.openStreamOnce(
        url,
        body,
        this.timeoutMs,
        signal,
      );

      if ("stream" in first) {
        return first.stream;
      }

      // One retry, sharing the original deadline, exactly as generateSpeech
      // does. An attempt only ever reports `retry` before its first audio
      // chunk was handed out, so a retry can never replay speech the caller
      // has already played.
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new CharivoTimeoutError(this.timeoutMessage, {
          cause: first.retry,
        });
      }

      const second = await this.openStreamOnce(url, body, remainingMs, signal);
      if ("stream" in second) {
        return second.stream;
      }

      throw second.retry;
    } catch (error) {
      // The caller's own cancellation is re-thrown unclassified, the way
      // fetchWithTimeout and the body channel below both hand it on: a stop()
      // must not read as a provider failure just because it happened to land
      // before the first chunk did.
      if (signal?.aborted && (error === signal.reason || isAbortError(error))) {
        throw error;
      }

      throw toCharivoError("provider", error, "Gemini TTS request failed");
    }
  }

  private buildRequestBody(text: string, voice: string): string {
    return JSON.stringify({
      contents: [{ parts: [{ text: `${PROMPT_PREAMBLE}${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    });
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

  private openStreamOnce(
    url: string,
    body: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<StreamAttemptResult> {
    // Both cancellation channels the streaming contract promises — the
    // caller's signal and the returned body's cancel() — feed this one
    // controller, because fetchWithTimeout takes a single signal.
    const attempt = new AbortController();
    const onCallerAbort = () => attempt.abort(signal!.reason);

    if (signal?.aborted) {
      attempt.abort(signal.reason);
    } else {
      signal?.addEventListener("abort", onCallerAbort);
    }

    let open: OpenStream | null = null;
    let cancelledByConsumer = false;
    let deliverStream!: (result: StreamAttemptResult) => void;
    const delivery = new Promise<StreamAttemptResult>((resolve) => {
      deliverStream = resolve;
    });

    const request = fetchWithTimeout<StreamAttemptResult>(
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
        signal: attempt.signal,
        mapError: (error) =>
          toCharivoError("provider", error, "Gemini TTS request failed"),
      },
      // The whole SSE pump runs in here, not after this helper resolves: the
      // helper unwires its timer and the caller's signal the moment this
      // callback settles, and an unwired request keeps downloading — keeps
      // Gemini synthesizing, and billing — long after a stop().
      async (response) => {
        // The same two retryable failure modes as the buffered path.
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

        const noAudio = (): StreamAttemptResult => ({
          retry: new CharivoProviderError(
            "Gemini TTS Error: response contained no audio",
          ),
        });

        // Past the hand-off every failure reaches the caller through the body,
        // and stops the upstream request: the rest of the utterance is lost
        // either way, and Gemini would keep synthesizing it.
        const fail = (message: string): never => {
          attempt.abort();
          throw new CharivoProviderError(`Gemini TTS Error: ${message}`);
        };

        const openWith = (audio: InlineAudio, pcm: Uint8Array): OpenStream => {
          const { sampleRate, channels } = parseL16MimeType(audio.mimeType);
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          const streamBody = new ReadableStream<Uint8Array>({
            start(streamController) {
              controller = streamController;
              streamController.enqueue(pcm);
            },
            cancel() {
              // The contract: cancelling the body cancels the request.
              cancelledByConsumer = true;
              attempt.abort();
            },
          });

          return {
            controller,
            mimeType: audio.mimeType,
            result: {
              stream: {
                body: streamBody,
                format: { encoding: "pcm-s16le", sampleRate, channels },
              },
            },
          };
        };

        const reader = response.body?.getReader();
        if (!reader) {
          return noAudio();
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (;;) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split(SSE_FRAME_SEPARATOR);
            // Whatever follows the last blank line is a half-received frame.
            buffer = frames.pop() ?? "";

            for (const frame of frames) {
              const { audio, finishReason } = extractStreamEvent(
                parseSseData(frame),
              );

              if (audio) {
                const pcm = decodeBase64(audio.data);

                if (!open) {
                  open = openWith(audio, pcm);
                  deliverStream(open.result);
                } else if (audio.mimeType !== open.mimeType) {
                  // The format went out with the first chunk; there is no way to
                  // revise it now.
                  fail(
                    `audio format changed to "${audio.mimeType}" mid-stream`,
                  );
                } else {
                  open.controller.enqueue(pcm);
                }
              }

              if (finishReason) {
                // The terminator ends this attempt without the body being read
                // to EOF, so the reader is still holding it -- and with it the
                // connection. fail() below releases it through its own abort;
                // the two returns have nothing else that would.
                void reader.cancel().catch(() => undefined);

                if (!open) {
                  return noAudio();
                }

                if (finishReason !== "STOP") {
                  // Measured: a long text is truncated under a 200 and ends on
                  // SAFETY. Only STOP means the utterance is complete.
                  fail(`stream ended with finishReason "${finishReason}"`);
                }

                open.controller.close();

                return open.result;
              }
            }
          }

          // EOF with no terminator: truncated the same way, minus the reason.
          return open
            ? fail("stream ended without a finish reason")
            : noAudio();
        } catch (error) {
          // Aborting after this callback returns reaches nothing: cleanup()
          // has already unhooked the listener forwarding to the controller the
          // fetch is bound to (fetch-with-timeout.ts:88-91). Without this, a
          // parse failure leaves the response draining and Gemini synthesizing
          // — and billing — the rest of the utterance.
          attempt.abort();
          throw error;
        }
      },
    );

    // The pump above outlives the hand-off, so this attempt's late outcome
    // belongs to the body rather than to the caller of this method — and
    // observing it here is what keeps a post-hand-off rejection from
    // surfacing as an unhandled one.
    const outcome = request.then(
      (result) => {
        signal?.removeEventListener("abort", onCallerAbort);

        return result;
      },
      (error: unknown) => {
        signal?.removeEventListener("abort", onCallerAbort);

        if (!open) {
          throw error;
        }

        // A body-phase timeout, the caller's abort, a dropped connection. A
        // body the consumer itself cancelled is asking for none of them.
        if (!cancelledByConsumer) {
          // Same guarantee as requestOnce's mapError — every failure escaping
          // this provider is a CharivoError — except an abort, which stays raw
          // so a consumer can still recognize its own cancellation.
          open.controller.error(
            isAbortError(error)
              ? error
              : toCharivoError("provider", error, "Gemini TTS request failed"),
          );
        }

        return open.result;
      },
    );

    // Whichever comes first: the stream, handed out on the first audio event,
    // or this attempt's own outcome — a retryable failure, or a rejection
    // from before any audio existed.
    return Promise.race([delivery, outcome]);
  }
}

export function createGeminiTTSProvider(
  config: GeminiTTSConfig,
): GeminiTTSProvider {
  return new GeminiTTSProvider(config);
}

function extractInlineAudio(payload: unknown): InlineAudio | null {
  const candidate = firstCandidate(payload);
  if (!candidate || !isRecord(candidate.content)) {
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

/** Streaming sibling of extractInlineAudio, reading one SSE event's payload. */
function extractStreamEvent(payload: unknown): StreamEvent {
  const candidate = firstCandidate(payload);
  const finishReason =
    candidate && typeof candidate.finishReason === "string"
      ? candidate.finishReason
      : null;

  return { audio: extractInlineAudio(payload), finishReason };
}

/** Reads a frame's `data:` payload; a frame carrying none yields null. */
function parseSseData(frame: string): unknown {
  const data = frame
    .split(SSE_LINE_SEPARATOR)
    .filter((line) => line.startsWith(SSE_DATA_PREFIX))
    .map((line) => line.slice(SSE_DATA_PREFIX.length).trim())
    .join("\n");

  return data ? JSON.parse(data) : null;
}

function firstCandidate(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return null;
  }

  const candidate = payload.candidates[0];

  return isRecord(candidate) ? candidate : null;
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
