import type {
  RealtimeProvider,
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@charivo/shared";

const DEFAULT_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

export interface OpenAIRealtimeProviderConfig {
  apiKey: string;
  baseUrl?: string;
  dangerouslyAllowBrowser?: boolean;
}

export class OpenAIRealtimeProvider implements RealtimeProvider {
  private endpoint: string;

  constructor(private config: OpenAIRealtimeProviderConfig) {
    if (typeof window !== "undefined" && !config.dangerouslyAllowBrowser) {
      throw new Error(
        "OpenAI realtime provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
      );
    }

    this.endpoint = config.baseUrl
      ? `${config.baseUrl.replace(/\/$/, "")}/realtime/calls`
      : DEFAULT_REALTIME_URL;
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
    model: session.model || "gpt-realtime-mini",
    audio: {
      output: {
        voice: session.voice || "marin",
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
