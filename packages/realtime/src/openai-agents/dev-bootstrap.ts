import {
  OPENAI_REALTIME_AGENTS_ADAPTER,
  CharivoProviderError,
} from "@charivo/core";
import type {
  RealtimeSessionConfig,
  RealtimeSessionRequest,
  RealtimeSessionBootstrap,
} from "@charivo/core";
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_VOICE,
} from "../openai/defaults";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRecord,
} from "../internal/shared";

// Fixed minting endpoint — no base URL override.
const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// Mirrors toOpenAIRealtimeSession in packages/server/src/openai/realtime/index.ts.
// Duplicated intentionally: browser clients must not import from @charivo/server
// (the same self-contained pattern as the tts/stt OpenAI providers).
function toClientSecretsSession(
  session: RealtimeSessionConfig,
): Record<string, unknown> {
  const audio: Record<string, unknown> = {
    output: {
      voice: session.voice ?? DEFAULT_OPENAI_REALTIME_VOICE,
    },
  };

  const transcription = session.inputAudioTranscription;
  if (transcription !== undefined) {
    if (transcription.enabled === false) {
      audio.input = { transcription: null };
    } else if (transcription.model !== undefined) {
      audio.input = { transcription: { model: transcription.model } };
    }
  }

  const payload: Record<string, unknown> = {
    type: "realtime",
    model: session.model ?? DEFAULT_OPENAI_REALTIME_MODEL,
    audio,
    tool_choice: session.toolChoice ?? "auto",
  };

  if (session.instructions) {
    payload.instructions = session.instructions;
  }

  if (session.temperature !== undefined) {
    payload.temperature = session.temperature;
  }

  if (session.maxTokens !== undefined) {
    payload.max_response_output_tokens = session.maxTokens;
  }

  if (session.tools?.length) {
    payload.tools = session.tools;
  }

  return payload;
}

// Mirrors extractClientSecret in packages/server/src/openai/realtime/index.ts.
function extractClientSecret(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.client_secret === "string") {
    return payload.client_secret;
  }

  if (
    isRecord(payload.client_secret) &&
    typeof payload.client_secret.value === "string"
  ) {
    return payload.client_secret.value;
  }

  if (typeof payload.value === "string") {
    return payload.value;
  }

  return null;
}

export function createOpenAIRealtimeDevBootstrap(
  apiKey: string,
): (request: RealtimeSessionRequest) => Promise<RealtimeSessionBootstrap> {
  return async (
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> => {
    const response = await fetchWithTimeout(
      CLIENT_SECRETS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: toClientSecretsSession(request.session),
        }),
      },
      `Realtime client secret request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new CharivoProviderError(
        `Failed to mint OpenAI realtime client secret: ${errorText}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CharivoProviderError(
        "Invalid client secret response: response body could not be parsed as JSON",
      );
    }

    const clientSecret = extractClientSecret(body);
    if (!clientSecret) {
      throw new CharivoProviderError(
        "Invalid client secret response: client_secret missing or empty",
      );
    }

    return {
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret,
    };
  };
}
