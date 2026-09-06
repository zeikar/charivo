import {
  CharivoProviderError,
  CharivoTimeoutError,
  CharivoTransportError,
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  readResponseErrorMessage,
  type TTSPcmFormat,
  type TTSPcmStream,
  type TTSPlayer,
  TTSOptions,
} from "@charivo/core";

/**
 * How long a started stream may go without a chunk before it counts as dead.
 *
 * `DEFAULT_FETCH_TIMEOUT_MS` covers connecting and the headers only. It cannot
 * also cover the body: `fetchWithTimeout` keeps its timer armed through body
 * consumption by design, so one fixed deadline over a streamed body silently
 * becomes a cap on utterance length and chops any reply longer than it. This
 * second timer is armed per upstream read instead, so a reply is only ever cut
 * for going quiet, never for being long -- which is also why there is no total
 * deadline: a stream that keeps arriving has nothing wrong with it.
 *
 * Those reads are driven by `pull`, so the window follows demand rather than
 * the consumer: it opens as soon as the stream wants a chunk, before any read
 * of the returned body, and stays shut while the consumer sits on a buffered
 * one. A consumer that stops reading is never timed out -- only a route that
 * stops sending is.
 */
const STREAM_INACTIVITY_TIMEOUT_MS = 10_000;

/** The sample rate assumed when the content type names no `rate`. */
const DEFAULT_STREAM_SAMPLE_RATE = 24_000;
/** The channel count assumed when it names none; mono is all this player takes. */
const DEFAULT_STREAM_CHANNELS = 1;

export interface RemoteTTSConfig {
  apiEndpoint?: string;
  defaultVoice?: string;
  /**
   * Opt in to `generateAudioStream`. Off by default: an unconditionally
   * streaming player would break every route that answers a container today,
   * and this player cannot fall back to the buffered path after a non-PCM
   * answer without paying for a second synthesis.
   */
  streaming?: boolean;
}

/**
 * Remote TTS Player - Stateless TTS Player that uses a remote server's TTS API
 *
 * Processes TTS on the server and receives the audio data
 * Stateless design: audio playback and lip-sync are handled by the TTS Manager
 */
class RemoteTTSPlayer implements TTSPlayer {
  readonly playbackMode = "audio" as const;
  /**
   * The container of the buffered `generateAudio` path only -- the streaming
   * path carries its layout in `TTSPcmStream.format` instead.
   *
   * Follows what the server said it sent, because the endpoint decides the
   * container: the demo's OpenAI route answers with MPEG and its Gemini one
   * with WAV. Naming either here would mislabel the other. Until a response
   * has been seen this is WAV, matching the manager's own fallback.
   */
  audioMimeType = "audio/wav";
  /**
   * Present only on a streaming player: the manager selects the streaming
   * path with `typeof player.generateAudioStream === "function"`, so an
   * unflagged player must not carry the method at all.
   */
  generateAudioStream?: (
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ) => Promise<TTSPcmStream>;
  private apiEndpoint: string;
  private defaultVoice: string;

  constructor(config: RemoteTTSConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/tts";
    this.defaultVoice = config.defaultVoice || "marin";

    if (config.streaming) {
      this.generateAudioStream = (text, options, signal) =>
        this.requestAudioStream(text, options, signal);
    }
  }

  /**
   * Stateless audio generation (used by the TTS Manager)
   */
  async generateAudio(
    text: string,
    options?: TTSOptions,
  ): Promise<ArrayBuffer> {
    return fetchWithTimeout(
      this.apiEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: this.buildRequestBody(text, options),
      },
      {
        timeoutMessage: `TTS request timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`,
        failureMessage: "TTS request failed",
      },
      // Consume the body while cancellation is still wired up, so a route that
      // sends headers and then stalls -- on the error path too, where the
      // message is read off the body -- still hits the deadline.
      async (response) => {
        if (!response.ok) {
          throw new CharivoProviderError(
            `TTS API failed: ${await readResponseErrorMessage(response)}`,
          );
        }

        const contentType = response.headers.get("content-type");
        if (contentType) {
          this.audioMimeType = contentType.split(";")[0]!.trim();
        }

        return response.arrayBuffer();
      },
    );
  }

  /** The one request payload both paths send; only the Accept header differs. */
  private buildRequestBody(text: string, options?: TTSOptions): string {
    return JSON.stringify({
      text,
      voice: options?.voice || this.defaultVoice,
      speed: options?.rate || 1.0,
      format: "wav",
    });
  }

  private async requestAudioStream(
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ): Promise<TTSPcmStream> {
    const response = await fetchWithTimeout(
      this.apiEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // A streaming route answers `audio/pcm`; a route that ignores this
          // answers its usual container, which is rejected below.
          Accept: "audio/pcm",
        },
        body: this.buildRequestBody(text, options),
      },
      {
        timeoutMessage: `TTS request timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`,
        failureMessage: "TTS request failed",
        signal,
      },
      // Returns the Response itself rather than draining it: the helper's
      // deadline covers connecting, the headers and an error body, and then
      // clears. Everything after that is the inactivity timer's business.
      async (settled) => {
        if (!settled.ok) {
          throw new CharivoProviderError(
            `TTS API failed: ${await readResponseErrorMessage(settled)}`,
          );
        }

        return settled;
      },
    );

    const rejectAnswer = (reason: string): never => {
      // A configuration error, not a fallback: the audio has been synthesized
      // and paid for already, so asking again on the buffered path would pay
      // for it twice. Cancelled so the route is not left draining a response
      // nobody will read -- and a body that already failed rejects its own
      // cancel() with a failure this error supersedes.
      void response.body?.cancel().catch(() => undefined);

      throw new CharivoProviderError(
        `Streaming TTS is enabled, but ${this.apiEndpoint} ${reason}`,
      );
    };

    const contentType = response.headers.get("content-type");
    const format = parsePcmContentType(contentType);

    if (!format) {
      return rejectAnswer(
        `answered "${contentType ?? "no content type"}" instead of audio/pcm`,
      );
    }

    if (format.channels !== 1) {
      return rejectAnswer(
        `answered ${format.channels} audio channels; the manager plays mono only`,
      );
    }

    const upstream = response.body;

    if (!upstream) {
      return rejectAnswer("answered audio/pcm with no body to read");
    }

    const reader = upstream.getReader();
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined;

    // Past the headers this is the only handle on the route: `fetchWithTimeout`
    // unwired its own controller when it handed the response back, so
    // cancelling the body is what stops the server synthesizing.
    const stopUpstream = () => {
      stopped = true;
      clearTimeout(inactivityTimer);
      signal?.removeEventListener("abort", onCallerAbort);
      // A body that already failed rejects its own cancel() with that same
      // failure, which the consumer is being told about through the stream.
      void reader.cancel().catch(() => undefined);
    };

    // The two ways to stop are NOT interchangeable, so they must not share one
    // path. Cancelling the returned body means the consumer has thrown that
    // body away and wants nothing further from it. An aborted signal leaves
    // the body alive in the consumer's hands, so stopping the route is only
    // half the job: a read already pending on it waits forever unless the
    // stream is settled too, and that read is exactly where a barge-in lands.
    const onCallerAbort = () => {
      stopUpstream();
      // A no-op once the stream is closed, errored or cancelled, so an abort
      // and a cancel arriving together produce one outcome, not two.
      streamController?.error(signal!.reason);
    };

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      async pull(controller) {
        const read = reader.read();
        const stalled = new Promise<never>((_, reject) => {
          inactivityTimer = setTimeout(() => {
            reject(
              new CharivoTimeoutError(
                `TTS stream stalled for ${STREAM_INACTIVITY_TIMEOUT_MS}ms`,
              ),
            );
          }, STREAM_INACTIVITY_TIMEOUT_MS);
        });

        try {
          // Armed per upstream read, never once over the stream, and only
          // while this queue-driven pull wants a chunk: see
          // STREAM_INACTIVITY_TIMEOUT_MS.
          const result = await Promise.race([read, stalled]);
          clearTimeout(inactivityTimer);

          if (stopped) {
            // Stopped while this read was outstanding. Both paths have
            // already settled what they own -- an abort errored the stream
            // above, a cancel threw it away -- so close() or enqueue() here
            // would throw a TypeError that the stream machinery then swallows.
            return;
          }

          if (result.done) {
            stopUpstream();
            controller.close();
            return;
          }

          controller.enqueue(result.value);
        } catch (error) {
          stopUpstream();
          throw error;
        }
      },
      cancel() {
        stopUpstream();
      },
    });

    // Wired only once the stream exists, so an abort always has something to
    // settle -- including one that landed while the headers were being read.
    if (signal?.aborted) {
      onCallerAbort();
    } else {
      signal?.addEventListener("abort", onCallerAbort);
    }

    return { format, body };
  }

  /**
   * Legacy speak method (kept for compatibility)
   */
  async speak(text: string, options?: TTSOptions): Promise<void> {
    // Perform simple playback only (no lip-sync)
    const audioBuffer = await this.generateAudio(text, options);
    const blob = new Blob([audioBuffer], { type: this.audioMimeType });
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

/**
 * Reads `audio/pcm; rate=…; channels=…`, the wire label a streaming route
 * answers with; anything else yields null for the caller to reject.
 *
 * Deliberately not `audio/l16`, whose RFC 2586 definition is big-endian: these
 * bytes are `pcm-s16le` by contract between the route and this player.
 *
 * Not shared with the Gemini provider's `parseL16MimeType`, which reads the
 * same two parameters: a different media type, a different return contract
 * (null for the caller to reject, rather than a throw), and opposite sides of
 * the browser/server split.
 */
function parsePcmContentType(header: string | null): TTSPcmFormat | null {
  const [mediaType, ...parameters] = (header ?? "").split(";");

  // Media types and parameter names are case-insensitive.
  if (mediaType?.trim().toLowerCase() !== "audio/pcm") {
    return null;
  }

  let sampleRate = DEFAULT_STREAM_SAMPLE_RATE;
  let channels = DEFAULT_STREAM_CHANNELS;

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

  return { encoding: "pcm-s16le", sampleRate, channels };
}

export function createRemoteTTSPlayer(config?: RemoteTTSConfig): TTSPlayer {
  return new RemoteTTSPlayer(config);
}
