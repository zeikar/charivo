import { describe, expect, it, vi } from "vitest";
import { StubLLMClient, createStubLLMClient } from "@charivo/llm-client-stub";

describe("StubLLMClient", () => {
  it("rotates through canned responses", async () => {
    vi.useFakeTimers();
    const client = new StubLLMClient();

    const firstCall = client.call([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await firstCall).toBe("Hello! [happy] I'm a test character.");

    const secondCall = client.call([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await secondCall).not.toBe("Hello! [happy] I'm a test character.");

    vi.useRealTimers();
  });

  it("provides a factory helper", () => {
    expect(createStubLLMClient()).toBeInstanceOf(StubLLMClient);
  });
});
