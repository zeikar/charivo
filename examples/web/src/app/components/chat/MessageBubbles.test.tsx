import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubbles } from "./MessageBubbles";

describe("MessageBubbles", () => {
  it("renders realtime draft", () => {
    const html = renderToStaticMarkup(
      <MessageBubbles
        messages={[]}
        isLoading
        realtimeAssistantDraft="Live draft"
      />,
    );

    expect(html).toContain("Live");
    expect(html).toContain("Live draft");
    expect(html).not.toContain("animate-bounce");
  });

  it("renders completed character bubbles and loading fallback", () => {
    const html = renderToStaticMarkup(
      <MessageBubbles
        messages={[
          {
            id: "msg-1",
            content: "Completed reply",
            timestamp: new Date("2026-04-12T00:00:00.000Z"),
            type: "character",
          },
        ]}
        isLoading
        realtimeAssistantDraft={null}
      />,
    );

    expect(html).toContain("Completed reply");
    expect(html).toContain("animate-bounce");
  });
});
