import {
  CharivoStateError,
  toCharivoError,
  type AffectCue,
  type BrainHistoryPolicy,
  type BrainInput,
  type BrainTurn,
  type BrainTurnResult,
  type Character,
  type CharacterBody,
  type CharivoError,
  type ConversationBrain,
  type EventMap,
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
 * One submitted input that responds. It is live while it is
 * `CascadeBrain.live` (`isLive`). A live turn whose performance has ended is
 * finished a microtask later; until then it is live but no longer under way
 * (`hasTurnUnderway`), which is what `auto` asks.
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
 * An `ephemeral` entry is removed without a write; a responding one still
 * queues, so its request waits for every input ahead of it.
 */
interface QueueEntry {
  message: Message;
  history: BrainHistoryPolicy;
  /** The turn of an input that responds. */
  turn?: CascadeTurn;
  /** Settles an input that does not respond, once its write has. */
  settleSilent?: (result: BrainTurnResult) => void;
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

  constructor(
    private readonly llm: LLMManager,
    private readonly review: CascadeBrainOptions["review"],
  ) {
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
    // Only detaching retires the live turn.
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

    const { message, respond, history } = resolveBrainInput(input);
    let settle!: (result: BrainTurnResult) => void;
    const done = new Promise<BrainTurnResult>((resolve) => {
      settle = resolve;
    });

    const responds =
      respond === "must" ||
      (respond === "auto" &&
        !this.hasTurnUnderway() &&
        body.getFloor().state === "idle");
    if (!responds) {
      // Leaves the live turn alone (B4); only its history policy applies.
      if (history === "ephemeral") {
        body.emit("message:sent", { message });
        settle({ status: "silent" });
      } else {
        this.queue.push({
          message,
          history,
          settleSilent: settle,
          inProgress: false,
        });
        body.emit("message:sent", { message });
        this.writeQueued(null);
      }
      return { id: message.id, done, cancel: () => Promise.resolve() };
    }

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
    const entry: QueueEntry = { message, history, turn, inProgress: false };
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
   * Whether a turn is under way, as `auto` asks (B4): the live turn, unless
   * its performance has ended and it is only waiting to be finished. Unlike
   * `isLive`, which decides whether a turn may act further, this never
   * counts that finished-but-live turn.
   */
  private hasTurnUnderway(): boolean {
    const live = this.live;
    return live !== undefined && !live.performance?.result;
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
   * or cost an older entry its place in a bounded history. Stops at an
   * entry being written further up the stack, and at the live turn's own
   * entry unless that turn is the `requester`.
   *
   * A requester's own write keeps its rollback and ends the call, so the
   * entries behind it stay queued until the requester's prompt is built
   * (B4); its failure is thrown.
   */
  private writeQueued(requester: CascadeTurn | null): void {
    this.retireSuperseded();
    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      if (head.inProgress) {
        return;
      }
      const isOwn = requester !== null && head.turn === requester;
      if (!isOwn && head.turn !== undefined && head.turn === this.live) {
        return;
      }

      head.inProgress = true;
      try {
        const rollback = this.store(head);
        this.removeEntry(head);
        if (isOwn) {
          requester.inputRollback = rollback;
          return;
        }
        head.settleSilent?.({ status: "silent" });
      } catch (error) {
        this.removeEntry(head);
        if (isOwn) {
          throw error;
        }
        // A retired turn has settled `cancelled` already, so an input the
        // manager refuses is dropped and the queue behind it still written.
        // An input that does not respond fails with that refusal (B5).
        head.settleSilent?.(
          failed("generate", "", toCharivoError("state", error)),
        );
      }
    }
  }

  /** Writes an entry by its history policy (B5). */
  private store(entry: QueueEntry): HistoryRollback | undefined {
    const { message, history } = entry;
    if (history === "ephemeral") {
      return undefined;
    }
    return history === "keep"
      ? this.llm.addToHistory(message)
      : this.llm.addToHistory(message, { replaceKey: history.replaceKey });
  }

  /** B10: commits the reply of the live `turn` once it has rendered. */
  private commitReply(
    turn: CascadeTurn,
    reply: Message,
    performance: PerformanceHandle,
    ephemeral: boolean,
  ): void {
    const llm = this.llm;
    // Held at the head of the write queue while the reply is written: a
    // manager that reenters submit() from that write leaves the newer turn
    // waiting, so its input and request come after the rollback below.
    const commit: QueueEntry = {
      message: reply,
      history: "keep",
      turn,
      inProgress: true,
    };
    this.queue.unshift(commit);
    try {
      // A reply to an ephemeral input has no stored prompt to lose (B5).
      turn.replyRollback = ephemeral
        ? llm.addToHistory(reply, { standalone: true })
        : llm.addToHistory(reply);
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
  }

  /** B7: a live turn's generation or review failed; its input is rolled back. */
  private failGeneration(
    turn: CascadeTurn,
    error: unknown,
    message: string,
  ): void {
    if (!this.isLive(turn)) {
      return;
    }
    turn.inputRollback?.();
    this.finish(
      turn,
      failed("generate", "", toCharivoError("provider", error, message)),
    );
  }

  private async run(turn: CascadeTurn, entry: QueueEntry): Promise<void> {
    const { body } = turn;
    const { message } = entry;
    const ephemeral = entry.history === "ephemeral";
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
      this.writeQueued(null);
      return;
    }
    if (!this.isLive(turn)) {
      this.writeQueued(null);
      return;
    }

    // B9: taken with the request, so a later history write does not change
    // it. A kept direction of the turn's own is in history already.
    const directions: Message[] = [];
    if (this.review) {
      directions.push(
        ...llm.getHistory().filter((entry) => entry.type === "direction"),
      );
      if (ephemeral && message.type === "direction") {
        directions.push(message);
      }
    }

    // B8: the last tool-chosen expression is held back and shown with the
    // reply, so a reply that is withheld or superseded shows no face.
    let toolAffect: AffectCue | undefined;
    const interceptProjection = (event: string, payload: unknown): boolean => {
      if (event !== "avatar:expression") {
        return false;
      }
      const { expressionId } = payload as EventMap["avatar:expression"];
      toolAffect = { expression: expressionId };
      return true;
    };

    // The request is made first; only then are the inputs queued behind this
    // turn's own written, so one that does not respond never lands in this
    // turn's prompt (B4). This relies on the manager building the prompt
    // before its first await, as the built-in LLMManager does.
    const request = (async () =>
      llm.generateResponse(message, {
        callerOwnsHistory: true,
        ephemeral,
        isCancelled: () => !this.isLive(turn),
        signal: turn.abortController.signal,
        interceptProjection,
      }))();
    this.writeQueued(null);

    let text: string;
    try {
      text = await request;
    } catch (error) {
      this.failGeneration(
        turn,
        error,
        "Failed to generate a character response",
      );
      return;
    }
    if (!this.isLive(turn)) {
      return;
    }
    let affect = toolAffect;

    // `turn.text` stays unset until review has approved the reply, so a turn
    // that ends before that never carries the unreviewed draft in `done`.
    if (this.review) {
      let reviewed: CascadeReply | null;
      try {
        const answer: unknown = await this.review({
          reply: { text, ...(affect ? { affect } : {}) },
          directions,
        });
        if (answer !== null && !isCascadeReply(answer)) {
          throw new TypeError(
            "review must return null or a reply with a string text",
          );
        }
        reviewed = answer;
      } catch (error) {
        this.failGeneration(turn, error, "The reply review failed");
        return;
      }
      if (!this.isLive(turn)) {
        return;
      }
      if (reviewed === null) {
        // Withheld: the input's history write stays (B9).
        this.finish(turn, { status: "silent" });
        return;
      }
      text = reviewed.text;
      // The reviewed reply's affect, else the tool's (B10).
      affect = reviewed.affect ?? affect;
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
      performance = body.perform({ text, origin: "cascade", affect });
    } catch (error) {
      this.finish(turn, failed("tts", text, toCharivoError("state", error)));
      return;
    }
    turn.performance = performance;
    if (!this.isLive(turn)) {
      // Retired while perform() delivered its start events, before the
      // handle could be recorded: stop it before anything is shown or heard.
      performance.cancel().catch(logStopFailure);
      return;
    }

    // The commit runs as a continuation of `started`, attached before
    // anything else can, so by the body's P3 it runs before speak() is
    // dispatched: the reply is in history only once it has rendered, and
    // always before it is heard.
    void performance.started.then((started) => {
      if (!started || !this.isLive(turn)) {
        return;
      }
      this.commitReply(turn, reply, performance, ephemeral);
      // The commit held the head of the queue, so an input submitted from
      // inside it waited there; write it now.
      this.writeQueued(null);
    });

    const result = await performance.done;
    // Unless a newer submit() or a cancel has finished it first.
    this.finish(turn, outcome(turn, result));
  }
}

/** What `review` hands back, checked since a JS caller can return anything. */
function isCascadeReply(value: unknown): value is CascadeReply {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { text?: unknown }).text === "string"
  );
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
  options: CascadeBrainOptions = {},
): ConversationBrain {
  return new CascadeBrain(llm, options.review);
}
