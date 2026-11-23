import type {
  AvatarControlCatalog,
  CharivoEventBus,
  CharivoEventEmitter,
  EventMap,
} from "@charivo/core";
import type { MotionArgs } from "./index";

export interface AvatarDecision {
  expressionId?: string;
  motion?: MotionArgs;
}

export type AvatarClassifier = (input: {
  text: string;
  catalog: AvatarControlCatalog;
  signal: AbortSignal;
}) => Promise<AvatarDecision>;

export interface AvatarDirectorOptions {
  catalog: AvatarControlCatalog;
  classifier: AvatarClassifier;
  /** Receives `avatar:expression` and `avatar:motion`; a `Charivo` instance fits. */
  emitter: CharivoEventEmitter;
  /** Defaults to `console.warn`. */
  onError?: (error: unknown) => void;
}

export interface AvatarDirector {
  /** Classify one complete line. */
  say(text: string): void;
  /** Append to the open line, or start a new one if none is open. */
  push(chunk: string): void;
  /** Close the open line and classify it. */
  done(): void;
  /** End the line: drop the open buffer and any pending decision. */
  cancel(): void;
}

export function createAvatarDirector(
  options: AvatarDirectorOptions,
): AvatarDirector {
  const { catalog, classifier, emitter } = options;
  const reportError =
    options.onError ??
    ((error: unknown) => {
      console.warn("[charivo/avatar] Avatar classifier failed:", error);
    });
  // A group with no clips offers nothing to play, so it alone is not worth a
  // classifier request.
  const hasControls =
    catalog.expressions.length > 0 ||
    Object.values(catalog.motions).some((count) => count > 0);

  // `null` means no incremental line is open, so the next push starts one.
  let buffer: string | null = null;
  // Identifies the current line's decision; replaced or cleared whenever the
  // line is superseded, which is what makes every older result stale.
  let current: AbortController | null = null;

  function endLine(): void {
    buffer = null;
    current?.abort();
    current = null;
  }

  function classify(text: string): void {
    if (!hasControls || text.trim() === "") {
      return;
    }

    const controller = new AbortController();
    current = controller;
    const isCurrent = () => current === controller;

    // Wrapping the call routes a synchronous throw or a non-promise return
    // through the same path as a rejection, so neither escapes say()/done().
    new Promise<AvatarDecision>((resolve) => {
      resolve(classifier({ text, catalog, signal: controller.signal }));
    }).then(
      (decision) => {
        apply(decision, isCurrent);
      },
      (error: unknown) => {
        // A superseded or cancelled line's failure, including the AbortError
        // its own aborted signal caused, belongs to a line that is over.
        if (isCurrent()) {
          reportError(error);
        }
      },
    );
  }

  // The single enforcement point for the catalog: a classifier may return
  // anything, and only ids and motions the model actually has reach the
  // renderer. Listeners run synchronously inside `emit`, so one can cancel or
  // start a new line between the two emissions; currency is rechecked before
  // each.
  function apply(decision: AvatarDecision, isCurrent: () => boolean): void {
    // `?.` because a classifier backed by parsed model output can hand back
    // nothing at all despite its type.
    const expressionId = decision?.expressionId;
    const motion = decision?.motion;

    if (
      isCurrent() &&
      typeof expressionId === "string" &&
      catalog.expressions.includes(expressionId)
    ) {
      emitter.emit("avatar:expression", { expressionId });
    }

    if (isCurrent() && motion && isValidMotion(motion)) {
      // The classifier, like a tool call, is the AI asking: the model's baked-in
      // sample clip would talk over the character's own voice.
      emitter.emit("avatar:motion", {
        group: motion.group,
        index: motion.index,
        muteSound: true,
      });
    }
  }

  function isValidMotion({ group, index }: MotionArgs): boolean {
    if (typeof group !== "string" || !Object.hasOwn(catalog.motions, group)) {
      return false;
    }
    const count = catalog.motions[group] ?? 0;
    return Number.isInteger(index) && index >= 0 && index < count;
  }

  return {
    say(text) {
      endLine();
      classify(text);
    },
    push(chunk) {
      if (buffer === null) {
        endLine();
        buffer = "";
      }
      buffer += chunk;
    },
    done() {
      const text = buffer ?? "";
      buffer = null;
      classify(text);
    },
    cancel() {
      endLine();
    },
  };
}

/**
 * Drive `director` from a cascade (`userSay()`) turn on `bus`; a `Charivo`
 * instance fits. Each final reply (`character:speak`) is classified as one
 * line, and the line ends on `tts:audio:end`, `tts:end`, `tts:error`, or
 * `turn:cancelled`, so a decision that arrives after the speech is dropped
 * rather than applied to silence.
 *
 * Two turns end without any of those events; call `director.cancel()`
 * yourself if a late decision should be dropped there: a text-only turn (no
 * TTS manager attached), and a turn that fails after `character:speak` but
 * before TTS starts (e.g. a renderer failure that rejects `userSay()`).
 * Otherwise the decision applies whenever it is ready and the next line
 * supersedes it.
 *
 * Returns a function that disconnects and drops any pending decision.
 */
export function connectAvatarDirectorToCascade(
  bus: CharivoEventBus,
  director: AvatarDirector,
): () => void {
  let active = true;
  // Charivo emits `message:received` and then the same turn's
  // `character:speak` synchronously, and listeners run in registration order.
  // An earlier `character:speak` listener that interrupts or supersedes the
  // turn therefore fires `turn:cancelled` before this helper sees that
  // `character:speak`; the turn then skips TTS, so no `tts:end` would ever end
  // the line. A cancellation since `message:received` marks that reply dead.
  let cancelledSinceReceived = false;

  // Every listener checks `active` first: the bus dispatches from a snapshot,
  // so one removed by a disconnect mid-dispatch can still be called.
  const onReceived = () => {
    if (!active) {
      return;
    }
    cancelledSinceReceived = false;
  };
  const onSpeak = ({ text }: EventMap["character:speak"]) => {
    if (!active || cancelledSinceReceived) {
      return;
    }
    director.say(text);
  };
  const onLineEnd = () => {
    if (!active) {
      return;
    }
    director.cancel();
  };
  const onCancelled = () => {
    if (!active) {
      return;
    }
    cancelledSinceReceived = true;
    director.cancel();
  };

  bus.on("message:received", onReceived);
  bus.on("character:speak", onSpeak);
  bus.on("tts:audio:end", onLineEnd);
  bus.on("tts:end", onLineEnd);
  bus.on("tts:error", onLineEnd);
  bus.on("turn:cancelled", onCancelled);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    bus.off("message:received", onReceived);
    bus.off("character:speak", onSpeak);
    bus.off("tts:audio:end", onLineEnd);
    bus.off("tts:end", onLineEnd);
    bus.off("tts:error", onLineEnd);
    bus.off("turn:cancelled", onCancelled);
    director.cancel();
  };
}
