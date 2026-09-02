import {
  CharivoProviderError,
  CharivoStateError,
  fetchWithTimeout,
  GEMINI_LIVE_ADAPTER,
} from "@charivo/core";
import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { DEFAULT_REQUEST_TIMEOUT_MS, isRecord } from "../internal/shared";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_VOICE,
} from "./defaults";

// Fixed endpoints — no base URL override, as in the OpenAI dev bootstrap.
const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GEMINI_LIVE_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

// Mirrors toMintBody in packages/server/src/gemini/realtime/index.ts.
// Duplicated intentionally: browser clients must not import from @charivo/server
// (the same self-contained pattern as the OpenAI dev bootstrap). The model and
// voice allow-lists are the one thing not copied: they protect a key owner from
// a browser that holds only a token, and here the browser holds the key.
function toMintBody(session: RealtimeSessionConfig): Record<string, unknown> {
  if (session.toolChoice === "none" || session.toolChoice === "required") {
    // The Live API has no tool-choice equivalent; refused rather than coerced,
    // so a dev session fails the way a minted one would.
    throw new CharivoStateError(
      `Gemini Live does not support toolChoice "${session.toolChoice}"`,
    );
  }

  if (session.inputAudioTranscription?.model !== undefined) {
    throw new CharivoStateError(
      `Gemini Live does not support inputAudioTranscription.model "${session.inputAudioTranscription.model}"`,
    );
  }

  const generationConfig: Record<string, unknown> = {
    responseModalities: ["AUDIO"],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: session.voice ?? DEFAULT_GEMINI_LIVE_VOICE,
        },
      },
    },
  };

  if (session.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = session.maxTokens;
  }

  const setup: Record<string, unknown> = {
    model: `models/${session.model ?? DEFAULT_GEMINI_LIVE_MODEL}`,
    generationConfig,
    // The only assistant-text source on native-audio models.
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

  // Off unless asked, as on OpenAI: the block is what turns it on, and it
  // bills extra.
  if (session.inputAudioTranscription?.enabled === true) {
    setup.inputAudioTranscription = {};
  }

  return {
    uses: 1,
    bidiGenerateContentSetup: setup,
  };
}

// Mirrors extractTokenName in packages/server/src/gemini/realtime/index.ts.
function extractTokenName(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  return typeof payload.name === "string" && payload.name.length > 0
    ? payload.name
    : null;
}

/**
 * Mints the same constrained, single-use token the server provider mints, from
 * the browser. Google's `auth_tokens` endpoint answers browser origins with
 * CORS headers, so nothing after this differs from the production path: the
 * token still carries the whole session, and the socket still connects to the
 * constrained endpoint.
 */
export function createGeminiLiveDevBootstrap(
  apiKey: string,
): (request: RealtimeSessionRequest) => Promise<RealtimeSessionBootstrap> {
  return async (
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> => {
    const response = await fetchWithTimeout(
      AUTH_TOKENS_URL,
      {
        method: "POST",
        headers: {
          // Never in the URL: proxies and request logs capture query strings.
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toMintBody(request.session)),
      },
      {
        timeoutMessage: `Gemini Live token request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
        failureMessage: "Realtime request failed",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new CharivoProviderError(
        `Failed to mint Gemini Live ephemeral token: ${errorText}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CharivoProviderError(
        "Invalid ephemeral token response: response body could not be parsed as JSON",
      );
    }

    const token = extractTokenName(body);
    if (!token) {
      throw new CharivoProviderError(
        "Invalid ephemeral token response: name missing or empty",
      );
    }

    return {
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: GEMINI_LIVE_WEBSOCKET_URL,
      token,
    };
  };
}
