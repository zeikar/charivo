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

vi.mock("@charivo/llm-provider-openclaw", () => ({
  createOpenClawLLMProvider: providerMocks.createOpenClawLLMProvider,
}));

import {
  OpenClawLLMClient,
  createOpenClawLLMClient,
} from "@charivo/llm-client-openclaw";

describe("OpenClawLLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("openclaw message");
    providerMocks.createOpenClawLLMProvider.mockClear();
  });

  it("forces dangerouslyAllowBrowser true for browser usage", () => {
    const client = new OpenClawLLMClient({
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

    expect(client).toBeInstanceOf(OpenClawLLMClient);
  });

  it("delegates call() to the provider's generateResponse", async () => {
    const client = createOpenClawLLMClient({ token: "token" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("openclaw message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });
});
