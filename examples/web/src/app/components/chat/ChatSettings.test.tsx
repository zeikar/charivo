// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  clickElement,
  renderComponent,
} from "../../test-utils/render-component";
import { ChatSettings } from "./ChatSettings";

/** Options are matched by their visible label; the icons contribute no text. */
function queryButtons(label: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button")).filter(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function queryButton(label: string): HTMLButtonElement | null {
  return queryButtons(label)[0] ?? null;
}

function clickButton(label: string): void {
  const button = queryButton(label);

  if (!button) {
    throw new Error(`no button labelled "${label}"`);
  }

  clickElement(button);
}

function renderOpenSettings(
  overrides: Partial<ComponentProps<typeof ChatSettings>> = {},
): void {
  renderComponent(
    <ChatSettings
      selectedLLMClient="remote"
      onSelectLLMClient={vi.fn()}
      selectedTTSPlayer="remote"
      onSelectTTSPlayer={vi.fn()}
      selectedSTTTranscriber="remote"
      onSelectSTTTranscriber={vi.fn()}
      selectedRealtimeProvider="openai"
      onSelectRealtimeProvider={vi.fn()}
      realtimeProviderLocked={false}
      llmError={null}
      ttsError={null}
      sttError={null}
      {...overrides}
    />,
  );

  // The panel is a Headless UI portal that does not exist in the DOM until the
  // menu opens, so every assertion below needs this first.
  clickButton("Settings");
}

describe("ChatSettings", () => {
  it("offers both Gemini LLM options", () => {
    renderOpenSettings();

    expect(queryButton("Gemini Remote")).not.toBeNull();
    expect(queryButton("Gemini Direct (Dev)")).not.toBeNull();
  });

  it("offers both realtime providers", () => {
    renderOpenSettings();

    expect(queryButton("OpenAI Realtime")).not.toBeNull();
    expect(queryButton("Gemini Live")).not.toBeNull();
  });

  it("offers both Gemini TTS options beside the LLM ones", () => {
    const onSelectTTSPlayer = vi.fn();
    renderOpenSettings({ onSelectTTSPlayer });

    // The LLM pair contributes one of each label; the TTS pair the other.
    expect(queryButtons("Gemini Remote")).toHaveLength(2);
    expect(queryButtons("Gemini Direct (Dev)")).toHaveLength(2);

    // The TTS section renders after the LLM section, so the last match is
    // the TTS button.
    clickElement(queryButtons("Gemini Remote").at(-1)!);
    expect(onSelectTTSPlayer).toHaveBeenCalledWith("gemini-remote");

    clickElement(queryButtons("Gemini Direct (Dev)").at(-1)!);
    expect(onSelectTTSPlayer).toHaveBeenCalledWith("gemini");
  });

  it("reports the picked provider", () => {
    const onSelectRealtimeProvider = vi.fn();
    renderOpenSettings({ onSelectRealtimeProvider });

    clickButton("Gemini Live");

    expect(onSelectRealtimeProvider).toHaveBeenCalledWith("gemini");
  });

  it("refuses a switch while a session holds the manager", () => {
    const onSelectRealtimeProvider = vi.fn();
    renderOpenSettings({
      onSelectRealtimeProvider,
      realtimeProviderLocked: true,
    });

    expect(queryButton("OpenAI Realtime")?.disabled).toBe(true);
    expect(queryButton("Gemini Live")?.disabled).toBe(true);

    clickButton("Gemini Live");

    expect(onSelectRealtimeProvider).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "End the call to switch providers",
    );
  });
});
