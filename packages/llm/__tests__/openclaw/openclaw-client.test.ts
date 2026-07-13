import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => {
  const generateResponse = vi.fn(
    async (_messages: Array<{ role: string; content: string }>) =>
      "openclaw message",
  );
  const createOpenClawLLMProvider = vi.fn(() => ({
    generateResponse,
  }));
  return { generateResponse, createOpenClawLLMProvider };
});

vi.mock("../../src/openclaw/provider", () => ({
  createOpenClawLLMProvider: providerMocks.createOpenClawLLMProvider,
}));

import {
  createOpenClawLLMClient,
  OpenClawLLMClientConfig,
} from "@charivo/llm/openclaw";

describe("OpenClawLLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("openclaw message");
    providerMocks.createOpenClawLLMProvider.mockClear();
  });

  it("forces dangerouslyAllowBrowser true for browser usage", () => {
    createOpenClawLLMClient({
      token: "test-token",
      agentId: "main",
    });

    expect(providerMocks.createOpenClawLLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "test-token",
        agentId: "main",
        dangerouslyAllowBrowser: true,
      }),
    );
  });

  it("delegates call() to the provider's generateResponse", async () => {
    const client = createOpenClawLLMClient({ token: "token" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("openclaw message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });

  it("never forwards sessionKey to the provider, even if a caller passes it", () => {
    // sessionKey isn't in OpenClawLLMClientConfig; widen the cast to prove an
    // untyped JS caller can't sneak it past the client either.
    createOpenClawLLMClient({
      token: "token",
      sessionKey: "conversation-abc",
    } as OpenClawLLMClientConfig & { sessionKey: string });

    const config = providerMocks.createOpenClawLLMProvider.mock.calls[0]![0];
    expect(config).not.toHaveProperty("sessionKey");
  });
});
