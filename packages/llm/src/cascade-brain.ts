import {
  CharivoStateError,
  toCharivoError,
  type AffectCue,
  type BrainInput,
  type BrainTurn,
  type BrainTurnResult,
  type Character,
  type CharacterBody,
  type CharivoError,
  type ConversationBrain,
  type LLMManager,
  type Message,
  type PerformanceHandle,
  type PerformanceResult,
} from "@charivo/core";
import { resolveBrainInput } from "./brain-input";

/** A reply as `review` sees it and returns it. */
export interface CascadeReply {
  text: string;
  /** Shown when the reply is performed. */
  affect?: AffectCue;
}

/** What `review` is handed for one reply. */
export interface CascadeReviewInput {
  reply: CascadeReply;
  /**
   * The `direction` entries of the request the reply came from: those in
   * history when it was built, plus the turn's own input when that is an
   * ephemeral direction.
   */
  directions: Message[];
}

export interface CascadeBrainOptions {
  /**
   * Runs between the reply and its presentation. The reply it returns is the
   * one presented; `null` ends the turn `silent` with nothing presented; a
   * throw ends it `failed` at `generate`.
   */
  review?: (
    input: CascadeReviewInput,
  ) => CascadeReply | null | Promise<CascadeReply | null>;
}

/**
 * One submitted input. It is live while it is `CascadeBrain.live` and its
 * performance, once it has one, has not ended.
 */
interface CascadeTurn {
  abortController: AbortController;
  /** The reply, once generated. */
  text?: string;
  performance?: PerformanceHandle;
  /** Set when committing the reply threw; the turn then fails at `generate`. */
  commitFailure?: CharivoError;
  settle(result: BrainTurnResult): void;
}

class CascadeBrain implements ConversationBrain {
  private body: CharacterBody | null = null;
  private live?: CascadeTurn;

  constructor(private readonly llm: LLMManager) {
    // One emitter for the manager's lifetime, forwarding to whichever body is
    // attached when an event is raised: tool events never reach a detached
    // body, and are dropped while none is attached.
    llm.setEventEmitter?.({
      emit: (event, data) => {
        this.body?.emit(event, data);
      },
    });
  }

  setBody(body: CharacterBody | null): void {
    this.body = body;
    // Only detaching retires the live turn; moving to another body does not
    // (B2), and the turn presents what remains of it on the body it started on.
    const live = this.liveTurn();
    if (body === null && live) {
      this.retireUnwaited(live);
    }
  }

  setCharacter(character: Character): void {
    this.llm.setCharacter(character);
  }

  clearHistory(): void {
    this.llm.clearHistory();
  }

  getHistory(): Message[] {
    return this.llm.getHistory();
  }

  submit(input: BrainInput): BrainTurn {
    const body = this.body;
    if (!body) {
      throw new CharivoStateError(
        "submit() was called with no body attached; attach the brain first",
      );
    }

    const { message } = resolveBrainInput(input);
    let settle!: (result: BrainTurnResult) => void;
    const done = new Promise<BrainTurnResult>((resolve) => {
      settle = resolve;
    });
    const turn: CascadeTurn = {
      abortController: new AbortController(),
      settle,
    };

    // Retiring a turn ends its performance, and a listener of that end may
    // submit a turn of its own; that one is retired too, so this call wins
    // and no turn is overwritten unsettled.
    for (
      let superseded = this.liveTurn();
      superseded;
      superseded = this.liveTurn()
    ) {
      this.retireUnwaited(superseded);
    }
    this.live = turn;
    body.emit("message:sent", { message });
    // Every expected failure is settled inside run(); this keeps `done` from
    // hanging on one that is not.
    this.run(turn, body, message).catch((error: unknown) => {
      this.finish(
        turn,
        failed(
          "generate",
          turn.text ?? "",
          toCharivoError("state", error, "The turn failed unexpectedly"),
        ),
      );
    });

    return {
      id: message.id,
      done,
      cancel: () => this.retire(turn),
    };
  }

  interrupt(): Promise<void> {
    const live = this.liveTurn();
    return live ? this.retire(live) : Promise.resolve();
  }

  async dispose(): Promise<void> {
    const live = this.liveTurn();
    try {
      if (live) {
        await this.retire(live);
      }
    } finally {
      this.llm.clearHistory();
    }
  }

  /**
   * The live turn. The body ends a performance and delivers its
   * `performance:end` before `done` resolves, so a turn whose performance has
   * ended is finished here from that result, synchronously: a listener of
   * that end never finds it live, and never retires a turn that is over.
   */
  private liveTurn(): CascadeTurn | undefined {
    const turn = this.live;
    const result = turn?.performance?.result;
    if (turn && result) {
      this.finish(turn, outcome(turn, result));
    }
    return this.live;
  }

  private isLive(turn: CascadeTurn): boolean {
    return this.liveTurn() === turn;
  }

  /** The turn ends with `result`, and stops being live. */
  private finish(turn: CascadeTurn, result: BrainTurnResult): void {
    if (this.live === turn) {
      this.live = undefined;
    }
    turn.settle(result);
  }

  /**
   * Ends a live turn `cancelled`: its request is aborted, its performance
   * cancelled. Resolves when that cancel has, rejecting with its stop's error.
   * A turn whose performance already ended is not live: `isLive()` settles it
   * from that result instead, and nothing is cancelled.
   */
  private retire(turn: CascadeTurn): Promise<void> {
    if (!this.isLive(turn)) {
      return Promise.resolve();
    }
    this.live = undefined;
    turn.abortController.abort();
    const cancelling = turn.performance?.cancel() ?? Promise.resolve();
    const heardText = turn.performance?.result?.heardText;
    turn.settle({
      status: "cancelled",
      text: turn.text ?? "",
      ...(heardText !== undefined ? { heardText } : {}),
    });
    return cancelling;
  }

  /** `retire()` with nobody waiting on the stop: a failure is logged. */
  private retireUnwaited(turn: CascadeTurn): void {
    this.retire(turn).catch((error: unknown) => {
      console.error("Failed to stop the cancelled turn's speech:", error);
    });
  }

  private async run(
    turn: CascadeTurn,
    body: CharacterBody,
    message: Message,
  ): Promise<void> {
    const llm = this.llm;

    let rollback: () => void;
    try {
      rollback = llm.addToHistory(message);
    } catch (error) {
      this.finish(turn, failed("generate", "", toCharivoError("state", error)));
      return;
    }
    if (!this.isLive(turn)) {
      return;
    }

    let text: string;
    try {
      text = await llm.generateResponse(message, {
        callerOwnsHistory: true,
        isCancelled: () => !this.isLive(turn),
        signal: turn.abortController.signal,
      });
    } catch (error) {
      if (!this.isLive(turn)) {
        return;
      }
      rollback();
      this.finish(
        turn,
        failed(
          "generate",
          "",
          toCharivoError(
            "provider",
            error,
            "Failed to generate a character response",
          ),
        ),
      );
      return;
    }
    if (!this.isLive(turn)) {
      return;
    }
    turn.text = text;

    const reply: Message = {
      id: `${message.id}-reply`,
      content: text,
      timestamp: new Date(),
      characterId: llm.getCharacter()?.id,
      type: "character",
    };
    body.emit("message:received", { message: reply });
    if (!this.isLive(turn)) {
      return;
    }

    let performance: PerformanceHandle;
    try {
      performance = body.perform({ text, origin: "cascade" });
    } catch (error) {
      this.finish(turn, failed("tts", text, toCharivoError("state", error)));
      return;
    }
    turn.performance = performance;

    // The commit runs as a continuation of `started`, attached before
    // anything else can, so by the body's P3 it runs before speak() is
    // dispatched: the reply is in history only once it has rendered, and
    // always before it is heard.
    void performance.started.then((started) => {
      if (!started || !this.isLive(turn)) {
        return;
      }
      try {
        llm.addToHistory(reply);
      } catch (error) {
        // Recorded before the cancel, so the ended performance reads as this
        // failure rather than a cancellation.
        turn.commitFailure = toCharivoError(
          "provider",
          error,
          "Failed to commit the character response",
        );
        // Keeps the uncommitted reply from being spoken. Nothing is speaking
        // yet, so no stop is issued and this should not reject.
        performance.cancel().catch((cancelError: unknown) => {
          console.error("Failed to cancel the uncommitted reply:", cancelError);
        });
      }
    });

    const result = await performance.done;
    // Usually finished already by liveTurn(), from a listener of the end.
    if (this.live === turn) {
      this.finish(turn, outcome(turn, result));
    }
  }
}

/** The turn's outcome from its ended performance (B11). */
function outcome(
  turn: CascadeTurn,
  result: PerformanceResult,
): BrainTurnResult {
  const text = turn.text ?? "";
  if (turn.commitFailure) {
    return failed("generate", text, turn.commitFailure);
  }
  switch (result.status) {
    case "completed":
      return { status: "completed", text, heardText: result.heardText };
    case "failed":
      // A string performance fails only at a step, and always with an error.
      return failed(result.failedAt!, text, result.error!);
    case "cancelled":
      return {
        status: "cancelled",
        text,
        ...(result.heardText !== undefined
          ? { heardText: result.heardText }
          : {}),
      };
  }
}

function failed(
  stage: "generate" | "render" | "tts",
  text: string,
  error: CharivoError,
): BrainTurnResult {
  return { status: "failed", stage, text, error };
}

/**
 * The cascade conversation brain: each input that responds is generated by
 * `llm` and performed through the attached body, the reply committed to
 * history once it has rendered and before it is spoken. Attach it with
 * `Charivo.attachBrain()` or `createCharivo({ brain })`.
 */
export function createCascadeBrain(
  llm: LLMManager,
  _options: CascadeBrainOptions = {},
): ConversationBrain {
  return new CascadeBrain(llm);
}
