import type { ExternalShowEvent, ShowEventSource } from "./types";

/** An external source fed by hand, such as the chat box. */
export interface PushSource extends ShowEventSource<ExternalShowEvent> {
  /** Emits `event` while the source is started; does nothing otherwise. */
  push(event: ExternalShowEvent): void;
}

export function createPushSource(): PushSource {
  let emit: ((event: ExternalShowEvent) => void) | null = null;
  return {
    start(next) {
      emit = next;
    },
    stop() {
      emit = null;
    },
    push(event) {
      emit?.(event);
    },
  };
}
