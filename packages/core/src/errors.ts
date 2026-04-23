export type CharivoErrorCode =
  | "CHARIVO_ERROR"
  | "CHARIVO_STATE_ERROR"
  | "CHARIVO_TIMEOUT_ERROR"
  | "CHARIVO_TRANSPORT_ERROR"
  | "CHARIVO_PROVIDER_ERROR"
  | "CHARIVO_DISPOSE_ERROR";

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
  return error instanceof CharivoError;
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
