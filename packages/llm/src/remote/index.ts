import {
  CharivoProviderError,
  CharivoTimeoutError,
  CharivoTransportError,
  type LLMClient,
} from "@charivo/core";

export interface RemoteLLMConfig {
  apiEndpoint?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Remote LLM Client - stateless client that calls the server API
 */
export class RemoteLLMClient implements LLMClient {
  private apiEndpoint: string;

  constructor(config: RemoteLLMConfig = {}) {
    this.apiEndpoint = config.apiEndpoint || "/api/chat";
  }

  async call(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const response = await fetchWithTimeout(
      this.apiEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
        }),
      },
      `LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new CharivoProviderError(
        `API call failed: ${errorData.error || response.statusText}`,
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new CharivoProviderError(
        data.error || "Failed to generate response",
      );
    }

    return data.message || "";
  }
}

export function createRemoteLLMClient(
  config?: RemoteLLMConfig,
): RemoteLLMClient {
  return new RemoteLLMClient(config);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new CharivoTimeoutError(timeoutMessage, { cause: error });
    }
    throw new CharivoTransportError("LLM request failed", {
      cause: error instanceof Error ? error : undefined,
    });
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
