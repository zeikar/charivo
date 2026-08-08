// Single source of truth for the error codes: the union type and the
// runtime Set are both derived from this tuple so they cannot diverge.
const CHARIVO_ERROR_CODES_LIST = [
  "CHARIVO_ERROR",
  "CHARIVO_STATE_ERROR",
  "CHARIVO_TIMEOUT_ERROR",
  "CHARIVO_TRANSPORT_ERROR",
  "CHARIVO_PROVIDER_ERROR",
  "CHARIVO_DISPOSE_ERROR",
] as const;

export type CharivoErrorCode = (typeof CHARIVO_ERROR_CODES_LIST)[number];

const CHARIVO_ERROR_CODES = new Set<CharivoErrorCode>(CHARIVO_ERROR_CODES_LIST);

export interface CharivoErrorOptions extends ErrorOptions {
  code?: CharivoErrorCode;
}

export class CharivoError extends Error {
  readonly code: CharivoErrorCode;

  constructor(message: string, options: CharivoErrorOptions = {}) {
    super(message, options);
    this.name = "CharivoError";
    this.code = options.code ?? "CHARIVO_ERROR";
  }
}

// Registry symbol: a duplicated copy of @charivo/core computes the same
// symbol via Symbol.for, so the brand check works across package copies
// (e.g. mismatched versions pulled in by different dependents).
const CHARIVO_ERROR_BRAND = Symbol.for("@charivo/core/CharivoError");

Object.defineProperty(CharivoError.prototype, CHARIVO_ERROR_BRAND, {
  value: true,
});

export class CharivoStateError extends CharivoError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, {
      ...options,
      code: "CHARIVO_STATE_ERROR",
    });
    this.name = "CharivoStateError";
  }
}

export class CharivoTimeoutError extends CharivoError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, {
      ...options,
      code: "CHARIVO_TIMEOUT_ERROR",
    });
    this.name = "CharivoTimeoutError";
  }
}

export class CharivoTransportError extends CharivoError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, {
      ...options,
      code: "CHARIVO_TRANSPORT_ERROR",
    });
    this.name = "CharivoTransportError";
  }
}

export class CharivoProviderError extends CharivoError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, {
      ...options,
      code: "CHARIVO_PROVIDER_ERROR",
    });
    this.name = "CharivoProviderError";
  }
}

export class CharivoDisposeError extends CharivoError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, {
      ...options,
      code: "CHARIVO_DISPOSE_ERROR",
    });
    this.name = "CharivoDisposeError";
  }
}

export type CharivoErrorKind =
  | "state"
  | "timeout"
  | "transport"
  | "provider"
  | "dispose";

export function isCharivoError(error: unknown): error is CharivoError {
  if (error instanceof CharivoError) {
    return true;
  }

  // instanceof only works within a single installed copy of @charivo/core.
  // Fall back to a structural check: Symbol.for is not a security boundary
  // (any object can set the same symbol), so we also verify the shape of a
  // CharivoError (a string code from the known set, a string message).
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!(CHARIVO_ERROR_BRAND in error)) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    CHARIVO_ERROR_CODES.has(candidate.code as CharivoErrorCode)
  );
}

export function getErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function toCharivoError(
  kind: CharivoErrorKind,
  error: unknown,
  fallbackMessage?: string,
): CharivoError {
  if (isCharivoError(error)) {
    return error;
  }

  const message = getErrorMessage(error, fallbackMessage);
  const options =
    error instanceof Error
      ? {
          cause: error,
        }
      : undefined;

  switch (kind) {
    case "state":
      return new CharivoStateError(message, options);
    case "timeout":
      return new CharivoTimeoutError(message, options);
    case "transport":
      return new CharivoTransportError(message, options);
    case "provider":
      return new CharivoProviderError(message, options);
    case "dispose":
      return new CharivoDisposeError(message, options);
  }
}
