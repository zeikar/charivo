// @vitest-environment jsdom

import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { renderComponent } from "./render-component";

function Line({ text }: { text: string }) {
  return <p>{text}</p>;
}

function ExplodesOnUnmount() {
  useLayoutEffect(
    () => () => {
      throw new Error("cleanup exploded");
    },
    [],
  );

  return <p>Doomed</p>;
}

describe("renderComponent", () => {
  it("replaces the previous render", () => {
    renderComponent(<Line text="First mount" />);
    const container = renderComponent(<Line text="Second mount" />);

    expect(container.textContent).toContain("Second mount");
    expect(document.body.textContent).not.toContain("First mount");
  });

  it("removes the container even when unmounting throws", () => {
    const doomed = renderComponent(<ExplodesOnUnmount />);

    expect(() => renderComponent(<Line text="After the throw" />)).toThrow(
      "cleanup exploded",
    );

    // React empties the container before the cleanup error surfaces, so what
    // leaks is the orphaned <div> itself, not any text in it. Asserting on
    // `document.body.textContent` here would pass with the cleanup removed.
    expect(doomed.isConnected).toBe(false);
    expect(renderComponent(<Line text="Recovered" />).textContent).toContain(
      "Recovered",
    );
  });
});
