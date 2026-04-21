import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealtimeStatusBadge } from "./RealtimeStatusBadge";

describe("RealtimeStatusBadge", () => {
  it("renders connecting", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="connecting" error={null} />,
    );

    expect(html).toContain("Connecting");
  });

  it("renders listening", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="listening" error={null} />,
    );

    expect(html).toContain("Listening");
  });

  it("renders responding", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="responding" error={null} />,
    );

    expect(html).toContain("Responding");
  });

  it("renders nothing for interrupted (message bubble handles it)", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="interrupted" error={null} />,
    );

    expect(html).toBe("");
  });

  it("renders reconnecting", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="reconnecting" error={null} />,
    );

    expect(html).toContain("Reconnecting");
  });

  it("renders error when present", () => {
    const html = renderToStaticMarkup(
      <RealtimeStatusBadge visible status="listening" error="boom" />,
    );

    expect(html).toContain("Error");
    expect(html).not.toContain("Listening");
  });
});
