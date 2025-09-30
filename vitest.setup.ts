import { vi } from "vitest";

const globalAny = globalThis as typeof globalThis & {
  setImmediate?: (
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => number;
  clearImmediate?: (id: number) => void;
  Audio?: typeof Audio;
};

if (typeof globalAny.setImmediate === "undefined") {
  globalAny.setImmediate = ((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => globalThis.setTimeout(fn, 0, ...args)) as any;
}

if (typeof globalAny.clearImmediate === "undefined") {
  globalAny.clearImmediate = ((id: number) =>
    globalThis.clearTimeout(id)) as any;
}

if (typeof globalAny.Audio === "undefined") {
  class MockAudio {
    src = "";
    currentTime = 0;
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;

    play = vi.fn(() => Promise.resolve());
    pause = vi.fn(() => undefined);
  }

  globalAny.Audio = MockAudio as unknown as typeof Audio;
}

if (typeof globalThis.URL !== "undefined") {
  if (typeof globalThis.URL.createObjectURL === "undefined") {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  }
  if (typeof globalThis.URL.revokeObjectURL === "undefined") {
    globalThis.URL.revokeObjectURL = vi.fn();
  }
}

if (typeof window !== "undefined") {
  const noop = () => undefined;

  class ResizeObserverStub {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  class MutationObserverStub {
    constructor(private callback: MutationCallback) {
      this.callback = callback;
    }
    observe = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }

  if (typeof window.ResizeObserver === "undefined") {
    // @ts-ignore
    window.ResizeObserver = ResizeObserverStub;
  }

  if (typeof window.MutationObserver === "undefined") {
    // @ts-ignore
    window.MutationObserver = MutationObserverStub;
  }

  if (typeof window.speechSynthesis === "undefined") {
    const speechSynthesisMock: SpeechSynthesis = {
      speaking: false,
      paused: false,
      pending: false,
      cancel: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
        if (typeof utterance.onend === "function") {
          const event = {
            utterance,
            charIndex: 0,
            charLength: 0,
            elapsedTime: 0,
            name: "end",
            bubbles: false,
            cancelBubble: false,
            cancelable: false,
            composed: false,
            currentTarget: null,
            defaultPrevented: false,
            eventPhase: 0,
            isTrusted: true,
            returnValue: true,
            srcElement: null,
            target: null,
            timeStamp: Date.now(),
            type: "end",
            preventDefault() {},
            stopImmediatePropagation() {},
            stopPropagation() {},
          } as SpeechSynthesisEvent;
          setTimeout(() => utterance.onend?.(event), 0);
        }
      }),
      getVoices: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
      onvoiceschanged: null,
      pause: vi.fn(),
      resume: vi.fn(),
    };

    Object.defineProperty(window, "speechSynthesis", {
      value: speechSynthesisMock,
      configurable: true,
    });
  }

  if (typeof window.SpeechSynthesisUtterance === "undefined") {
    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: MockUtterance,
      configurable: true,
    });
  }

  if (typeof window.fetch === "undefined") {
    window.fetch = vi.fn();
  }

  if (typeof window.console === "undefined") {
    // @ts-ignore - jsdom always provides console but keep fallback
    window.console = console;
  }

  if (!window.matchMedia) {
    // @ts-ignore
    window.matchMedia = () => ({
      matches: false,
      addListener: noop,
      removeListener: noop,
    });
  }
}
