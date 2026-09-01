import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

// `IS_REACT_ACT_ENVIRONMENT` is not on React's ambient global types, and
// `examples/web` typechecks this file under `strict`. Reach it through the same
// typed intersection `vitest.setup.ts` uses for `Audio`.
const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

// Captured once, not per render: a re-render would otherwise capture `true`.
const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;

let mounted: { root: Root; container: HTMLDivElement } | null = null;

function unmountCurrent(): void {
  if (!mounted) {
    return;
  }

  const { root, container } = mounted;
  mounted = null;

  try {
    // Unmounting outside `act` while the act environment is on reports the
    // teardown render as "An update to Root inside a test was not wrapped in
    // act(...)".
    act(() => {
      root.unmount();
    });
  } finally {
    // A throwing unmount must not strand the container: `ChatSettings.test.tsx`
    // queries `document.body`, so an orphan here becomes a stale match there.
    container.remove();
  }
}

/**
 * Mounts a component into a real DOM and returns its container, replacing any
 * container this harness mounted earlier.
 *
 * `MessageBubbles.test.tsx` renders to static markup in the node environment,
 * which cannot click anything, so interaction tests need this instead. It lives
 * here rather than in either test file because the act flag, the mount and the
 * teardown have to stay one implementation; split in two, the next fix lands on
 * one copy. Callers need `// @vitest-environment jsdom`.
 */
export function renderComponent(ui: ReactNode): HTMLDivElement {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  unmountCurrent();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };

  act(() => {
    root.render(ui);
  });

  return container;
}

/** Clicks through React's event system, flushing the resulting render. */
export function clickElement(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  try {
    unmountCurrent();
  } finally {
    // Restored even if the unmount threw; otherwise the flag stays on for every
    // remaining test in the file.
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});
