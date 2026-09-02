import type {
  RealtimeSessionBootstrap,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  CharivoProviderError,
  CharivoStateError,
  fetchWithTimeout,
} from "@charivo/core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRealtimeSessionBootstrap,
} from "../internal/shared";
import { createGeminiLiveDevBootstrap } from "./dev-bootstrap";

export interface GeminiLiveBootstrapLoaderOptions {
  apiEndpoint?: string;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
  apiKey?: string;
}

/**
 * Precedence is `sessionBootstrap` > `apiEndpoint` > `apiKey`, as in the
 * OpenAI Agents transport.
 */
export async function getGeminiLiveBootstrap(
  options: GeminiLiveBootstrapLoaderOptions,
  request: RealtimeSessionRequest,
): Promise<RealtimeSessionBootstrap> {
  if (options.sessionBootstrap) {
    return options.sessionBootstrap(request);
  }

  const apiEndpoint = options.apiEndpoint;
  if (!apiEndpoint && options.apiKey) {
    return createGeminiLiveDevBootstrap(options.apiKey)(request);
  }

  if (!apiEndpoint) {
    throw new CharivoStateError(
      "Gemini Live client requires sessionBootstrap, apiEndpoint, or apiKey",
    );
  }

  const response = await fetchWithTimeout(
    apiEndpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
    {
      timeoutMessage: `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
      failureMessage: "Realtime request failed",
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new CharivoProviderError(
      `Failed to create Realtime session: ${errorText}`,
    );
  }

  const bootstrap = (await response.json()) as unknown;
  if (!isRealtimeSessionBootstrap(bootstrap)) {
    throw new CharivoProviderError(
      "Invalid realtime session bootstrap response",
    );
  }

  return bootstrap;
}
