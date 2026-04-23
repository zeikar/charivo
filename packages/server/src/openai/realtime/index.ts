import type {
  RealtimeProvider,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  OPENAI_REALTIME_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";

const DEFAULT_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/client_secrets";
// Mirrors packages/realtime/src/openai/defaults.ts until the server/browser
// OpenAI defaults consolidate under ROADMAP P0-ARCH-2.
const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface OpenAIRealtimeProviderConfig {
  apiKey: string;
  baseUrl?: string;
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAIRealtimeProvider implements RealtimeProvider {
  private endpoint: string;
  private clientSecretsEndpoint: string;

  constructor(private config: OpenAIRealtimeProviderConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenAI realtime provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.endpoint = config.baseUrl
      ? `${config.baseUrl.replace(/\/$/, "")}/realtime/calls`
      : DEFAULT_REALTIME_URL;
    this.clientSecretsEndpoint = config.baseUrl
      ? `${config.baseUrl.replace(/\/$/, "")}/realtime/client_secrets`
      : DEFAULT_CLIENT_SECRETS_URL;
  }

  async createSession(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    if (
      request.session.provider !== undefined &&
      request.session.provider !== "openai"
    ) {
      throw new Error(
        `OpenAI realtime provider only supports provider "openai", received ${request.session.provider}`,
      );
    }

    if (request.transport !== "webrtc") {
      throw new Error(
        `OpenAI realtime provider only supports webrtc transport, received ${request.transport}`,
      );
    }

    if (request.adapter === OPENAI_REALTIME_AGENTS_ADAPTER) {
      return this.createAgentsSession(request.session);
    }

    if (
      request.adapter !== undefined &&
      request.adapter !== OPENAI_REALTIME_ADAPTER
    ) {
      throw new Error(
        `OpenAI realtime provider does not support adapter "${request.adapter}"`,
      );
    }

    if (!request.sdpOffer) {
      throw new Error("SDP offer is required for WebRTC realtime sessions");
    }

    const response = await fetchWithTimeout(
      this.endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: toRealtimeFormData(request),
      },
      `OpenAI realtime request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Realtime Error: ${errorText}`);
    }

    return {
      adapter: OPENAI_REALTIME_ADAPTER,
      transport: "webrtc",
      answerSdp: await response.text(),
    };
  }

  private async createAgentsSession(
    session: RealtimeSessionConfig,
  ): Promise<RealtimeSessionBootstrap> {
    const response = await fetchWithTimeout(
      this.clientSecretsEndpoint,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: toOpenAIRealtimeSession(session),
        }),
      },
      `OpenAI realtime request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI Realtime Error: ${errorText}`);
    }

    const payload = (await response.json()) as unknown;
    const clientSecret = extractClientSecret(payload);

    if (!clientSecret) {
      throw new Error("OpenAI Realtime Error: invalid client secret response");
    }

    return {
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret,
    };
  }
}

export function createOpenAIRealtimeProvider(
  config: OpenAIRealtimeProviderConfig,
): OpenAIRealtimeProvider {
  return new OpenAIRealtimeProvider(config);
}

function toRealtimeFormData(request: RealtimeSessionRequest): FormData {
  const formData = new FormData();
  formData.set("sdp", request.sdpOffer || "");
  formData.set(
    "session",
    JSON.stringify(toOpenAIRealtimeSession(request.session)),
  );
  return formData;
}

function toOpenAIRealtimeSession(
  session: RealtimeSessionConfig,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: "realtime",
    model: session.model ?? DEFAULT_OPENAI_REALTIME_MODEL,
    audio: {
      output: {
        voice: session.voice ?? DEFAULT_OPENAI_REALTIME_VOICE,
      },
    },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage);
    }
    throw error;
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
