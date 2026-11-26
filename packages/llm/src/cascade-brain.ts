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
  type HistoryRollback,
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
 *
 * Retiring it (B6): a newer turn takes its place and its queue position
 * first. After that turn's `message:sent`, the retired one's performance is
 * cancelled, an unheard reply rolled back and `done` settled; then queued
 * inputs are written, its request aborted and its `turn:cancelled` emitted.
 */
interface CascadeTurn {
  id: string;
  /** The body it was submitted on, which hears its `turn:cancelled`. */
  body: CharacterBody;
  abortController: AbortController;
  /** Undoes the input's own write, for a live generation failure (B7). */
  inputRollback?: HistoryRollback;
  /** The reply, once generated. */
  text?: string;
  performance?: PerformanceHandle;
  /** Undoes the reply's commit, for a cancellation nobody heard (B11). */
  replyRollback?: HistoryRollback;
  /** Set when committing the reply threw; the turn then fails at `generate`. */
  commitFailure?: CharivoError;
  /** The cancel of its performance, when retiring it cancelled one. */
  cancelling?: Promise<void>;
  /** How it settled, once it has. */
  result?: BrainTurnResult;
  settle(result: BrainTurnResult): void;
}

/**
 * An input's place in the write queue, taken when it is submitted, so
 * history order is call order at any reentrancy depth. `inProgress` marks
 * the entry being written, which stops a reentrant flush from jumping it.
 */
interface QueueEntry {
  message: Message;
  turn: CascadeTurn;
  inProgress: boolean;
}

class CascadeBrain implements ConversationBrain {
  private body: CharacterBody | null = null;
  private live?: CascadeTurn;
  private readonly queue: QueueEntry[] = [];
  /**
   * Turns that stopped being live and are not retired yet, oldest first.
   * Several can wait here: a `message:sent` listener may supersede the
   * newer turn before that turn has retired its predecessor, and the
   * nested call retires both before it writes anything.
   */
  private readonly superseded: CascadeTurn[] = [];

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
    const live = this.live;
    if (body === null && live) {
      this.cancelTurn(live).catch(logStopFailure);
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
      id: message.id,
      body,
      abortController: new AbortController(),
      settle,
    };

    // The newer turn is installed and queued before anything reentrant can
    // run, so a submit() from any listener below comes later in call order,
    // wins, and queues its input behind this one.
    const previous = this.live;
    this.live = turn;
    const entry: QueueEntry = { message, turn, inProgress: false };
    this.queue.push(entry);
    if (previous) {
      this.superseded.push(previous);
    }
    body.emit("message:sent", { message });
    this.retireSuperseded();
    if (previous) {
      previous.cancelling?.catch(logStopFailure);
      this.announce(previous);
    }

    if (this.isLive(turn)) {
      // Every expected failure is settled inside run(); this keeps `done`
      // from hanging on one that is not.
      this.run(turn, entry).catch((error: unknown) => {
        this.finish(
          turn,
          failed(
            "generate",
            turn.text ?? "",
            toCharivoError("state", error, "The turn failed unexpectedly"),
          ),
        );
      });
    }

    return {
      id: message.id,
      done,
      cancel: () =>
        this.isLive(turn) ? this.cancelTurn(turn) : Promise.resolve(),
    };
  }

  interrupt(): Promise<void> {
    const live = this.live;
    return live ? this.cancelTurn(live) : Promise.resolve();
  }

  async dispose(): Promise<void> {
    const live = this.live;
    try {
      if (live) {
        await this.cancelTurn(live);
      }
    } finally {
      this.llm.clearHistory();
    }
  }

  /**
   * Whether `turn` is the live one. A live turn whose performance has ended
   * is finished after `performance.done`, or by the retirement of a newer
   * submit() or a cancel when one comes first.
   */
  private isLive(turn: CascadeTurn): boolean {
    return this.live === turn;
  }

  /**
   * The live turn ended on its own with `result`. Its performance cancelled
   * by someone else (an app `perform()`, the body's `interrupt()`) ends it
   * `cancelled`, announced here.
   */
  private finish(turn: CascadeTurn, result: BrainTurnResult): void {
    if (this.live !== turn) {
      return;
    }
    this.live = undefined;
    this.conclude(turn, result);
    if (result.status === "cancelled") {
      turn.body.emit("turn:cancelled", { turnId: turn.id });
    }
  }

  /** Settles `turn`, rolling back its reply when it was cancelled unheard. */
  private conclude(turn: CascadeTurn, result: BrainTurnResult): void {
    turn.result ??= result;
    turn.settle(turn.result);
    if (turn.result.status === "cancelled") {
      this.rollBackUnheard(turn);
    }
  }

  /**
   * The logical half of retiring (B6), for every turn that has stopped being
   * live: a performance still running is cancelled, and the turn settles
   * from its performance's result, `cancelled` when it had none, with an
   * unheard reply rolled back. A listener of the cancelled performance's end
   * may submit again; its own call here finishes the turn from the result
   * the cancel has already set, before any write of its own.
   */
  private retireSuperseded(): void {
    for (;;) {
      const turn = this.superseded[0];
      if (!turn) {
        return;
      }
      const performance = turn.performance;
      if (performance && !performance.result) {
        turn.cancelling = performance.cancel();
        if (this.superseded[0] !== turn) {
          // Finished by a call made from a listener of that cancel.
          continue;
        }
      }
      this.superseded.shift();
      this.conclude(
        turn,
        performance?.result
          ? outcome(turn, performance.result)
          : { status: "cancelled", text: turn.text ?? "" },
      );
    }
  }

  /** Retires the live turn with no successor (B12), and announces it. */
  private cancelTurn(turn: CascadeTurn): Promise<void> {
    this.live = undefined;
    this.superseded.push(turn);
    this.retireSuperseded();
    this.announce(turn);
    return turn.cancelling ?? Promise.resolve();
  }

  /**
   * The rest of retiring `turn`, once its successor, if any, is announced
   * and queued: the queued inputs are written, then a cancelled turn's
   * request is aborted and its `turn:cancelled` emitted, in that order, since
   * an abort listener may submit again and has to find the input written.
   */
  private announce(turn: CascadeTurn): void {
    this.writeQueued(null);
    if (turn.result?.status === "cancelled") {
      turn.abortController.abort();
      turn.body.emit("turn:cancelled", { turnId: turn.id });
    }
  }

  /** B11: a committed reply whose cancelled performance nobody heard. */
  private rollBackUnheard(turn: CascadeTurn): void {
    const result = turn.performance?.result;
    if (result?.status === "cancelled" && result.heardText === "") {
      turn.replyRollback?.();
    }
    turn.replyRollback = undefined;
  }

  private removeEntry(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Writes queued inputs head first, after retiring every superseded turn,
   * so an unheard reply is rolled back before it can reach the next request
   * or cost an older entry its place in a bounded history. Returns at an
   * entry being written further up the stack.
   *
   * With `requester` null it writes the entries of turns that are no longer
   * live and stops at the live turn's. With a requester it writes the older
   * entries and then the requester's own, keeping that write's rollback and
   * throwing that write's failure.
   */
  private writeQueued(requester: CascadeTurn | null): void {
    this.retireSuperseded();
    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      if (head.inProgress) {
        return;
      }
      const isOwn = head.turn === requester;
      if (!isOwn && head.turn === this.live) {
        return;
      }

      head.inProgress = true;
      try {
        const rollback = this.llm.addToHistory(head.message);
        this.removeEntry(head);
        if (isOwn) {
          head.turn.inputRollback = rollback;
          return;
        }
      } catch (error) {
        this.removeEntry(head);
        if (isOwn) {
          throw error;
        }
        // A retired turn has settled `cancelled` already, so an input the
        // manager refuses is dropped and the queue behind it still written.
      }
    }
  }

  private async run(turn: CascadeTurn, entry: QueueEntry): Promise<void> {
    const { body } = turn;
    const { message } = entry;
    const llm = this.llm;

    try {
      // Nothing generates until the queue has reached this turn's own entry:
      // an older one can be mid-write further up the stack, and the request
      // must carry every input ahead of this one.
      for (;;) {
        this.writeQueued(turn);
        if (!this.queue.includes(entry)) {
          break;
        }
        await Promise.resolve();
        if (!this.isLive(turn)) {
          return;
        }
      }
    } catch (error) {
      if (this.isLive(turn)) {
        this.finish(
          turn,
          failed("generate", "", toCharivoError("state", error)),
        );
      }
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
      turn.inputRollback?.();
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
      // Held at the head of the write queue while the reply is written: a
      // manager that reenters submit() from that write leaves the newer turn
      // waiting, so its input and request come after the rollback below.
      const commit: QueueEntry = { message: reply, turn, inProgress: true };
      this.queue.unshift(commit);
      try {
        turn.replyRollback = llm.addToHistory(reply);
      } catch (error) {
        this.removeEntry(commit);
        // A manager that reentered submit() and then threw has retired the
        // turn: it stays cancelled, its performance already cancelled.
        if (!this.isLive(turn)) {
          return;
        }
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
        return;
      }
      this.removeEntry(commit);
      // Retired from inside the write, when there was no reply to roll back.
      if (!this.isLive(turn)) {
        this.rollBackUnheard(turn);
      }
    });

    const result = await performance.done;
    // Unless a newer submit() or a cancel has finished it first.
    this.finish(turn, outcome(turn, result));
  }
}

/** A retirement nobody waits on: its failed stop is reported here (P5). */
function logStopFailure(error: unknown): void {
  console.error("Failed to stop the cancelled turn's speech:", error);
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
