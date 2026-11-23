import type { AvatarControlCatalog, CharivoEventEmitter } from "@charivo/core";
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
  const hasControls =
    catalog.expressions.length > 0 || Object.keys(catalog.motions).length > 0;

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
