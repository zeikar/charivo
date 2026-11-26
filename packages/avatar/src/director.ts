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
  /**
   * Receives `avatar:expression` and `avatar:motion`; a `Charivo` instance
   * fits.
   */
  emitter: CharivoEventEmitter;
  /** Defaults to `console.warn`. */
  onError?: (error: unknown) => void;
}

export interface AvatarDirector {
  /**
   * Classify one complete line. With `performanceId` the expression is held
   * until that performance ends; without it the channel default applies.
   */
  say(text: string, options?: { performanceId?: string }): void;
  /** Append to the open line, or start a new one if none is open. */
  push(chunk: string): void;
  /** Close the open line and classify it. */
  done(): void;
  /** End the line: drop the open buffer and any pending decision. */
  cancel(): void;
}

/**
 * Text-driven avatar control. Its expression is an `inferred` claim from the
 * `avatar-director` source, so an `explicit` expression claim (a tool call, an
 * app event) outranks it.
 */
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

  // Every new line state is committed before the previous controller is
  // aborted: abort listeners run synchronously and may start or extend a line
  // of their own, which must not be overwritten afterwards.
  function startLine(text: string, performanceId?: string): void {
    const previous = current;
    const controller =
      hasControls && text.trim() !== "" ? new AbortController() : null;
    buffer = null;
    current = controller;
    previous?.abort();
    if (controller && current === controller) {
      classify(text, controller, performanceId);
    }
  }

  function endLine(): void {
    startLine("");
  }

  function classify(
    text: string,
    controller: AbortController,
    performanceId: string | undefined,
  ): void {
    const isCurrent = () => current === controller;

    // Wrapping the call routes a synchronous throw or a non-promise return
    // through the same path as a rejection, so neither escapes say()/done().
    new Promise<AvatarDecision>((resolve) => {
      resolve(classifier({ text, catalog, signal: controller.signal }));
    })
      .then(
        (decision) => {
          apply(decision, isCurrent, performanceId);
        },
        (error: unknown) => {
          // A superseded or cancelled line's failure, including the AbortError
          // its own aborted signal caused, belongs to a line that is over.
          if (isCurrent()) {
            // Returned so an async onError's rejection reaches the handler below.
            return reportError(error);
          }
        },
      )
      .catch((error: unknown) => {
        // A throwing emitter or onError would otherwise be an unhandled
        // rejection; onError is not invoked again, as it may be what threw.
        console.warn("[charivo/avatar] Avatar director failed:", error);
      });
  }

  // The single enforcement point for the catalog: a classifier may return
  // anything, and only ids and motions the model actually has reach the
  // renderer. Listeners run synchronously inside `emit`, so one can cancel or
  // start a new line between the two emissions; currency is rechecked before
  // each.
  function apply(
    decision: AvatarDecision,
    isCurrent: () => boolean,
    performanceId: string | undefined,
  ): void {
    // `?.` because a classifier backed by parsed model output can hand back
    // nothing at all despite its type.
    const expressionId = decision?.expressionId;
    const motion = decision?.motion;

    if (
      isCurrent() &&
      typeof expressionId === "string" &&
      catalog.expressions.includes(expressionId)
    ) {
      emitter.emit("avatar:expression", {
        expressionId,
        source: "avatar-director",
        priority: "inferred",
        ...(performanceId !== undefined && {
          hold: { performance: performanceId },
        }),
      });
    }

    if (isCurrent() && motion && isValidMotion(motion)) {
      // The classifier, like a tool call, is the AI asking: the model's baked-in
      // sample clip would talk over the character's own voice.
      emitter.emit("avatar:motion", {
        group: motion.group,
        index: motion.index,
        muteSound: true,
        priority: "inferred",
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
    say(text, options) {
      startLine(text, options?.performanceId);
    },
    push(chunk) {
      if (buffer === null) {
        const previous = current;
        current = null;
        buffer = chunk;
        previous?.abort();
        return;
      }
      buffer += chunk;
    },
    done() {
      // No open stream: a duplicate done(), or one after say(), must not
      // abort the line already being classified.
      if (buffer === null) {
        return;
      }
      startLine(buffer);
    },
    cancel() {
      endLine();
    },
  };
}

/**
 * Drive `director` from a cascade (`userSay()`) turn on `bus`; a `Charivo`
 * instance fits. Each voiced reply (`tts:start`, which Charivo emits after the
 * reply is rendered and recorded, just before speaking) is classified as one
 * line, and the line ends on `tts:audio:end`, `tts:end`, `tts:error`, or
 * `turn:cancelled`, so a decision that arrives after the speech is dropped
 * rather than applied to silence.
 *
 * A turn that fails before TTS starts, such as a renderer failure, is never
 * classified. A text-only turn (no TTS manager) emits no `tts:start` either,
 * so the helper does not classify it; call `director.say(text)` yourself where
 * the app accepts the text reply. The app owns cancellation
 * (`director.cancel()`) on that path.
 *
 * Returns a function that disconnects and drops any pending decision.
 */
export function connectAvatarDirectorToCascade(
  bus: CharivoEventBus,
  director: AvatarDirector,
): () => void {
  let active = true;
  // Charivo emits `tts:start` for a turn and then speaks it, and listeners run
  // in registration order. An earlier `tts:start` listener that interrupts or
  // supersedes the turn therefore fires `turn:cancelled` before this helper
  // sees that `tts:start`; the turn then skips TTS, so no `tts:end` would ever
  // end the line. A cancellation since `message:received` marks that reply
  // dead.
  let cancelledSinceReceived = false;

  // Every listener checks `active` first: the bus dispatches from a snapshot,
  // so one removed by a disconnect mid-dispatch can still be called.
  const onReceived = () => {
    if (!active) {
      return;
    }
    cancelledSinceReceived = false;
  };
  const onTTSStart = ({ text }: EventMap["tts:start"]) => {
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
  bus.on("tts:start", onTTSStart);
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
    bus.off("tts:start", onTTSStart);
    bus.off("tts:audio:end", onLineEnd);
    bus.off("tts:end", onLineEnd);
    bus.off("tts:error", onLineEnd);
    bus.off("turn:cancelled", onCancelled);
    director.cancel();
  };
}

/**
 * Drive `director` from performances on `bus`; a `Charivo` instance fits. A
 * voiced performance whose affect did not resolve (`affectResolved` is not
 * `true`) is classified: a string performance once, from its
 * `performance:start` text, a stream segment by segment from
 * `performance:segment`. The expression is held until that performance ends,
 * and `performance:end` for it drops a decision still pending.
 *
 * An unvoiced performance is not classified, and neither is one whose affect
 * resolved: the resolved cue already speaks for it. A cue whose label mapped
 * to nothing leaves `affectResolved` false, so inference still runs.
 *
 * Returns a function that disconnects and drops any pending decision.
 */
export function connectAvatarDirectorToPerformances(
  bus: CharivoEventBus,
  director: AvatarDirector,
): () => void {
  let active = true;
  // The voiced performance whose text is being inferred, if any.
  let inferring: string | null = null;

  // Every listener checks `active` first: the bus dispatches from a snapshot,
  // so one removed by a disconnect mid-dispatch can still be called.
  const onStart = ({
    performanceId,
    voiced,
    text,
    affectResolved,
  }: EventMap["performance:start"]) => {
    if (!active || !voiced) {
      return;
    }
    inferring = affectResolved === true ? null : performanceId;
    if (inferring !== null && text !== undefined) {
      director.say(text, { performanceId });
    }
  };
  const onSegment = ({
    performanceId,
    text,
  }: EventMap["performance:segment"]) => {
    if (!active || performanceId !== inferring) {
      return;
    }
    director.say(text, { performanceId });
  };
  const onEnd = ({ performanceId }: EventMap["performance:end"]) => {
    if (!active || performanceId !== inferring) {
      return;
    }
    inferring = null;
    director.cancel();
  };

  bus.on("performance:start", onStart);
  bus.on("performance:segment", onSegment);
  bus.on("performance:end", onEnd);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    inferring = null;
    bus.off("performance:start", onStart);
    bus.off("performance:segment", onSegment);
    bus.off("performance:end", onEnd);
    director.cancel();
  };
}
