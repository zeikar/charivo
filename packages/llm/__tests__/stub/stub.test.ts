import { describe, expect, it, vi } from "vitest";
import { createStubLLMClient } from "@charivo/llm/stub";

describe("StubLLMClient", () => {
  it("rotates through canned responses", async () => {
    vi.useFakeTimers();
    const client = createStubLLMClient();

    const firstCall = client.call([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await firstCall).toBe("Hello! I'm a test character.");

    const secondCall = client.call([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await secondCall).not.toBe("Hello! I'm a test character.");

    vi.useRealTimers();
  });

  it("creates independent client instances with their own rotation state", async () => {
    vi.useFakeTimers();
    const first = createStubLLMClient();
    const second = createStubLLMClient();

    const firstResult = first.call([]);
    await vi.advanceTimersByTimeAsync(500);
    const secondResult = second.call([]);
    await vi.advanceTimersByTimeAsync(500);

    // A fresh client starts its own rotation from the first canned response,
    // so two independently created clients are not sharing a rotation index.
    expect(await firstResult).toBe("Hello! I'm a test character.");
    expect(await secondResult).toBe("Hello! I'm a test character.");

    vi.useRealTimers();
  });
});
