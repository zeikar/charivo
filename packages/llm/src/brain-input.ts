import type {
  BrainHistoryPolicy,
  BrainInput,
  BrainRespond,
  Message,
} from "@charivo/core";

export interface ResolvedBrainInput {
  /** The history entry the input becomes. */
  message: Message;
  respond: BrainRespond;
  history: BrainHistoryPolicy;
}

export interface ResolveBrainInputOptions {
  /** Defaults to a fresh `<kind>-<time>-<n>` id. */
  id?: string;
  /** Defaults to now. */
  timestamp?: Date;
}

const DEFAULTS: Record<
  BrainInput["kind"],
  { respond: BrainRespond; history: BrainHistoryPolicy }
> = {
  user: { respond: "must", history: "keep" },
  event: { respond: "auto", history: "keep" },
  direction: { respond: "must", history: "ephemeral" },
};

let sequence = 0;

/**
 * Turn a typed brain input into the history entry it becomes, with the
 * per-kind defaults filled in: `user` must/keep, `event` auto/keep,
 * `direction` must/ephemeral. Pure apart from the generated id and time.
 */
export function resolveBrainInput(
  input: BrainInput,
  options: ResolveBrainInputOptions = {},
): ResolvedBrainInput {
  const defaults = DEFAULTS[input.kind];
  sequence += 1;

  const message: Message = {
    id: options.id ?? `${input.kind}-${Date.now()}-${sequence}`,
    content: input.text,
    timestamp: options.timestamp ?? new Date(),
    type: input.kind,
  };

  if (input.kind === "user" && input.speaker !== undefined) {
    message.source = input.speaker;
  } else if (input.kind === "event") {
    message.source = input.source;
  }

  return {
    message,
    respond: input.respond ?? defaults.respond,
    history: input.history ?? defaults.history,
  };
}
