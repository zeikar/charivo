// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  clickElement,
  renderComponent,
} from "../../test-utils/render-component";
import { RealtimeErrorNotice } from "./RealtimeErrorNotice";

function findDismiss(container: HTMLElement): HTMLButtonElement {
  const dismiss = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Dismiss"]',
  );

  if (!dismiss) {
    throw new Error("no dismiss control rendered");
  }

  return dismiss;
}

describe("RealtimeErrorNotice", () => {
  it("shows the failure message", () => {
    const container = renderComponent(
      <RealtimeErrorNotice
        message="GEMINI_API_KEY is not configured"
        onDismiss={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("GEMINI_API_KEY is not configured");
  });

  it("renders nothing without a message", () => {
    const container = renderComponent(
      <RealtimeErrorNotice message={null} onDismiss={vi.fn()} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("dismisses through the prop", () => {
    const onDismiss = vi.fn();
    const container = renderComponent(
      <RealtimeErrorNotice message="Session ended" onDismiss={onDismiss} />,
    );

    clickElement(findDismiss(container));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
