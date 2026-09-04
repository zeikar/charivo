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
 *
 * `consumeBody`, when given, is called with the resolved Response while
 * cancellation is still wired up, so an external abort (or timeout) that
 * lands during body consumption (e.g. `response.json()`) still aborts the
 * underlying request instead of only being able to cancel up to the point
 * headers arrive. Its rejection is classified the same way a `fetch()`
 * rejection is for abort/timeout; any other rejection (e.g. an error the
 * callback throws deliberately) passes through unchanged, matching how a
 * caller used to handle the body itself outside this helper.
 */
export function fetchWithTimeout<T = Response>(
  input: RequestInfo | URL,
  init: Omit<RequestInit, "signal"> & { signal?: never },
  options: FetchWithTimeoutOptions,
  consumeBody?: (response: Response) => Promise<T>,
): Promise<T> {
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

  const cleanup = () => {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onExternalAbort);
  };

  // Shared by the fetch() phase and the body-consumption phase so an abort
  // observed in either phase is classified the same way. Returns a
  // discriminated result rather than using null/undefined as a sentinel:
  // `AbortController.abort(null)` is a valid reason, so a matched
  // classification whose value happens to be null/undefined must still be
  // distinguishable from "not classified".
  const classifyAbort = (
    error: unknown,
  ): { matched: true; value: unknown } | { matched: false } => {
    if (
      abortSource === "external" &&
      (error === signal?.reason || isAbortError(error))
    ) {
      return { matched: true, value: error };
    }

    if (abortSource === "timeout" && isAbortError(error)) {
      return {
        matched: true,
        value: new CharivoTimeoutError(timeoutMessage, { cause: error }),
      };
    }

    return { matched: false };
  };

  return fetch(input, { ...init, signal: controller.signal }).then(
    (response) => {
      if (!consumeBody) {
        cleanup();
        return response as unknown as T;
      }

      // Routed through Promise.resolve().then() so a synchronous throw from
      // consumeBody() itself (before it returns a promise) still lands in
      // the rejection handler below and runs cleanup(), instead of skipping
      // straight to an uncleaned-up rejection.
      return Promise.resolve()
        .then(() => consumeBody(response))
        .then(
          (result) => {
            cleanup();
            return result;
          },
          (error: unknown) => {
            cleanup();
            // Non-abort rejections from the callback (e.g. a deliberately
            // thrown provider error) pass through unchanged, same as when a
            // caller consumed the body itself after this helper resolved.
            const classified = classifyAbort(error);
            throw classified.matched ? classified.value : error;
          },
        );
    },
    (error: unknown) => {
      cleanup();
      const classified = classifyAbort(error);
      throw classified.matched
        ? classified.value
        : (mapError?.(error) ??
            new CharivoTransportError(failureMessage, {
              cause: error instanceof Error ? error : undefined,
            }));
    },
  );
}

/**
 * Reads the most specific failure message a non-ok response carries.
 *
 * Remote clients talk to a caller-supplied route, and a route that took the
 * trouble to explain itself is the only place the real cause lives -- a
 * provider rate limit or an upstream outage reaches the browser as a bare
 * status line otherwise. Routes in this repo answer with `{ error, details? }`,
 * where `details` carries the vendor's own text; both are read here, most
 * specific first, falling back to the status line.
 *
 * A body that is not JSON is not an error in itself, so it falls back. Any
 * other read failure -- an abort or timeout part-way through the body --
 * propagates, so `fetchWithTimeout` can classify it instead of it being masked
 * as a provider error.
 */
export async function readResponseErrorMessage(
  response: Response,
): Promise<string> {
  let body: { error?: unknown; details?: unknown } = {};

  try {
    body = (await response.json()) as typeof body;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  const detail = typeof body.details === "string" ? body.details : undefined;
  const summary = typeof body.error === "string" ? body.error : undefined;

  return detail ?? summary ?? response.statusText;
}
