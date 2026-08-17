/**
 * Shared `fetch` wrapper for browser and server remote callers: enforces a
 * timeout, layers an optional external cancellation signal on top, and
 * classifies the failure into the CharivoError taxonomy so every remote
 * caller reports it the same way.
 */
import { CharivoTimeoutError, CharivoTransportError } from "./errors";

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface FetchWithTimeoutOptions {
  /** CharivoTimeoutError message when the internal timeout fires. */
  timeoutMessage: string;
  /** Fixed message for the default CharivoTransportError wrap of non-abort failures. */
  failureMessage?: string;
  timeoutMs?: number;
  /** External cancellation. An abort observed from this signal (its exact reason, or an AbortError) is re-thrown as-is; a coincidental non-abort rejection racing it is still classified normally. */
  signal?: AbortSignal;
  /** Overrides the default transport wrap (server providers map to provider errors instead). */
  mapError?: (error: unknown) => Error;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * `init.signal` is typed `never` so callers cannot pass a signal directly —
 * `options.signal` is the single cancellation channel, composed internally
 * with the timeout's own controller.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: Omit<RequestInit, "signal"> & { signal?: never },
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const {
    timeoutMessage,
    failureMessage = "Request failed",
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    signal,
    mapError,
  } = options;

  const controller = new AbortController();

  // Recorded at abort time, never inferred from signal state at catch time:
  // a late external abort must not relabel a rejection the timeout already
  // caused, and vice versa.
  let abortSource: "external" | "timeout" | null = null;

  const onExternalAbort = () => {
    if (abortSource === null) {
      abortSource = "external";
    }
    controller.abort(signal!.reason);
  };

  if (signal?.aborted) {
    // Already cancelled before the call even starts: forward synchronously,
    // before fetch is invoked below, and never register a listener for it.
    abortSource = "external";
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", onExternalAbort);
  }

  const timeoutId = setTimeout(() => {
    if (abortSource === null) {
      abortSource = "timeout";
    }
    controller.abort();
  }, timeoutMs);

  return fetch(input, { ...init, signal: controller.signal })
    .catch((error: unknown) => {
      if (
        abortSource === "external" &&
        (error === signal?.reason || isAbortError(error))
      ) {
        throw error;
      }

      if (abortSource === "timeout" && isAbortError(error)) {
        throw new CharivoTimeoutError(timeoutMessage, { cause: error });
      }

      throw (
        mapError?.(error) ??
        new CharivoTransportError(failureMessage, {
          cause: error instanceof Error ? error : undefined,
        })
      );
    })
    .finally(() => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onExternalAbort);
    });
}
