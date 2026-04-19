import type {
  RealtimeSessionBootstrap,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
} from "../internal/shared";

export interface RealtimeBootstrapLoaderOptions {
  apiEndpoint?: string;
  sessionBootstrap?: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
}

export async function getOpenAIRealtimeAgentsBootstrap(
  options: RealtimeBootstrapLoaderOptions,
  request: RealtimeSessionRequest,
): Promise<RealtimeSessionBootstrap> {
  if (options.sessionBootstrap) {
    return options.sessionBootstrap(request);
  }

  const apiEndpoint = options.apiEndpoint;
  if (!apiEndpoint) {
    throw new Error(
      "OpenAI agents realtime client requires apiEndpoint or sessionBootstrap",
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
    throw new Error(`Failed to create Realtime session: ${errorText}`);
  }

  const bootstrap = (await response.json()) as unknown;
  if (!isRealtimeSessionBootstrap(bootstrap)) {
    throw new Error("Invalid realtime session bootstrap response");
  }

  return bootstrap;
}
