import type {
  RealtimeSessionBootstrap,
  RealtimeSessionRequest,
} from "@charivo/core";
import { CharivoProviderError, CharivoStateError } from "@charivo/core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
} from "../internal/shared";
import { createOpenAIRealtimeDevBootstrap } from "./dev-bootstrap";

export interface RealtimeBootstrapLoaderOptions {
  apiEndpoint?: string;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
  apiKey?: string;
}

export async function getOpenAIRealtimeAgentsBootstrap(
  options: RealtimeBootstrapLoaderOptions,
  request: RealtimeSessionRequest,
): Promise<RealtimeSessionBootstrap> {
  if (options.sessionBootstrap) {
    return options.sessionBootstrap(request);
  }

  const apiEndpoint = options.apiEndpoint;
  if (!apiEndpoint && options.apiKey) {
    return createOpenAIRealtimeDevBootstrap(options.apiKey)(request);
  }

  if (!apiEndpoint) {
    throw new CharivoStateError(
      "OpenAI agents realtime client requires sessionBootstrap, apiEndpoint, or apiKey",
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
    `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
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
