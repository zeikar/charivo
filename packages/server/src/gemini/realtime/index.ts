import type {
  RealtimeProvider,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  CharivoProviderError,
  CharivoStateError,
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  type FetchWithTimeoutOptions,
  GEMINI_LIVE_ADAPTER,
  toCharivoError,
} from "@charivo/core";

const DEFAULT_AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GEMINI_LIVE_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
// Gemini Live defaults, intentionally duplicated with the browser transport's
// own defaults rather than shared. Strict layering keeps server and browser
// providers self-contained (no shared module / cross-package dep) — the same
// pattern the OpenAI and tts/stt defaults follow.
const DEFAULT_GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_GEMINI_LIVE_VOICE = "Kore";
// The browser chooses from these; it cannot name a model or voice of its own.
// `gemini-3.1-flash-live-preview` is the one exercised against the live API
// (2026-08-29, tests/gemini-live-smoke/README.md); the rest come from Google's
// published model and voice lists.
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
]);
const ALLOWED_VOICES = new Set([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]);
const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

const REQUEST_TIMEOUT_OPTIONS: FetchWithTimeoutOptions = {
  timeoutMessage: `Gemini realtime request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
  // DNS/TLS/connection failures land here as raw fetch errors — map them so
  // every failure escaping this provider is a CharivoError.
  mapError: (error) =>
    toCharivoError("provider", error, "Gemini realtime request failed"),
};

export interface GeminiRealtimeProviderConfig {
  apiKey: string;
  baseUrl?: string;
  dangerouslyAllowBrowser?: boolean;
}

export class GeminiRealtimeProvider implements RealtimeProvider {
  private endpoint: string;

  constructor(private config: GeminiRealtimeProviderConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new CharivoStateError(
        "Gemini realtime provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.endpoint = config.baseUrl
      ? `${config.baseUrl.replace(/\/$/, "")}/v1beta/auth_tokens`
      : DEFAULT_AUTH_TOKENS_URL;
  }

  async createSession(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    if (
      request.session.provider !== undefined &&
      request.session.provider !== "gemini"
    ) {
      throw new CharivoStateError(
        `Gemini realtime provider only supports provider "gemini", received ${request.session.provider}`,
      );
    }

    if (request.transport !== "websocket") {
      throw new CharivoStateError(
        `Gemini realtime provider only supports websocket transport, received ${request.transport}`,
      );
    }

    if (
      request.adapter !== undefined &&
      request.adapter !== GEMINI_LIVE_ADAPTER
    ) {
      throw new CharivoStateError(
        `Gemini realtime provider does not support adapter "${request.adapter}"`,
      );
    }

    const session = request.session;

    if (session.toolChoice === "none" || session.toolChoice === "required") {
      // The Live API has no tool-choice equivalent, so an unsupported value
      // is rejected outright rather than silently coerced to "auto".
      throw new CharivoStateError(
        `Gemini realtime provider does not support toolChoice "${session.toolChoice}"`,
      );
    }

    if (session.inputAudioTranscription?.model !== undefined) {
      // No Gemini mapping for a chosen transcription model — reject rather
      // than silently discard the caller's choice.
      throw new CharivoStateError(
        `Gemini realtime provider does not support inputAudioTranscription.model "${session.inputAudioTranscription.model}"`,
      );
    }

    const model = session.model ?? DEFAULT_GEMINI_LIVE_MODEL;
    if (!ALLOWED_MODELS.has(model)) {
      throw new CharivoStateError(
        `Gemini realtime provider does not support model "${model}"`,
      );
    }

    // Unknown voices fall back to the provider default rather than erroring:
    // voice costs nothing, so a stale value should not break the session.
    const voice =
      session.voice && ALLOWED_VOICES.has(session.voice)
        ? session.voice
        : DEFAULT_GEMINI_LIVE_VOICE;

    const response = await fetchWithTimeout(
      this.endpoint,
      {
        method: "POST",
        headers: {
          // Never in the URL: proxies and request logs capture query strings.
          "x-goog-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toMintBody(session, model, voice)),
      },
      REQUEST_TIMEOUT_OPTIONS,
    );

    if (!response.ok) {
      const errorText = await readResponseText(response);
      throw new CharivoProviderError(`Gemini Realtime Error: ${errorText}`);
    }

    const payload = await readResponseJson(response);
    const token = extractTokenName(payload);

    if (!token) {
      throw new CharivoProviderError(
        "Gemini Realtime Error: invalid ephemeral token response",
      );
    }

    return {
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: GEMINI_LIVE_WEBSOCKET_URL,
      token,
    };
  }
}

export function createGeminiRealtimeProvider(
  config: GeminiRealtimeProviderConfig,
): GeminiRealtimeProvider {
  return new GeminiRealtimeProvider(config);
}

/**
 * `bidiGenerateContentSetup` REPLACES the client's setup frame rather than
 * validating it (measured: a token pinning only `model` opens a session that
 * closes with 1007 on TEXT-modality defaults), so the entire session config
 * has to be built here — never forwarded from the caller as-is, or an
 * unconstrained token would let the holder pick any model on the key owner's
 * bill.
 */
function toMintBody(
  session: RealtimeSessionConfig,
  model: string,
  voice: string,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: voice },
      },
    },
  };

  if (session.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = session.maxTokens;
  }

  const setup: Record<string, unknown> = {
    model: `models/${model}`,
    generationConfig,
    // The only assistant-text source on native-audio models — there is no
    // separate text channel — so this is always requested even though it is
    // billed.
    outputAudioTranscription: {},
  };

  if (session.instructions) {
    setup.systemInstruction = { parts: [{ text: session.instructions }] };
  }

  if (session.tools?.length) {
    setup.tools = [
      {
        functionDeclarations: session.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];
  }

  // Transcription bills extra, so an explicit opt-out omits the block; it is
  // otherwise always requested.
  if (session.inputAudioTranscription?.enabled !== false) {
    setup.inputAudioTranscription = {};
  }

  // `expireTime` / `newSessionExpireTime` are left to Google's defaults (30 min
  // and 1 min) on purpose: the browser connects immediately after minting, and
  // a reconnect must mint again anyway because `uses: 1` is enforced — a
  // replayed token closes the socket with 1011.
  return {
    uses: 1,
    bidiGenerateContentSetup: setup,
  };
}

function extractTokenName(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return typeof payload.name === "string" && payload.name.length > 0
    ? payload.name
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw toCharivoError(
      "provider",
      error,
      "Failed to read Gemini realtime response body",
    );
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw toCharivoError(
      "provider",
      error,
      "Failed to parse Gemini realtime response body",
    );
  }
}
