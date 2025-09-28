import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => {
  const generateResponse = vi.fn(
    async (_messages: Array<{ role: string; content: string }>) =>
      "assistant message",
  );
  const createOpenAILLMProvider = vi.fn(() => ({
    generateResponse,
  }));
  return { generateResponse, createOpenAILLMProvider };
});

vi.mock("@charivo/llm-provider-openai", () => ({
  createOpenAILLMProvider: providerMocks.createOpenAILLMProvider,
}));

import {
  OpenAILLMClient,
  createOpenAILLMClient,
} from "@charivo/llm-client-openai";

describe("OpenAILLMClient", () => {
  beforeEach(() => {
    providerMocks.generateResponse.mockClear();
    providerMocks.generateResponse.mockResolvedValue("assistant message");
    providerMocks.createOpenAILLMProvider.mockClear();
  });

  it("enforces browser usage via configuration", () => {
    const client = new OpenAILLMClient({ apiKey: "test", model: "gpt-4o" });

    expect(providerMocks.createOpenAILLMProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test",
        model: "gpt-4o",
        dangerouslyAllowBrowser: true,
      }),
    );

    expect(client).toBeInstanceOf(OpenAILLMClient);
  });

  it("delegates calls to the provider", async () => {
    const client = createOpenAILLMClient({ apiKey: "key" });

    const messages = [{ role: "user" as const, content: "hello" }];
    const response = await client.call(messages);

    expect(response).toBe("assistant message");
    expect(providerMocks.generateResponse).toHaveBeenCalledWith(messages);
  });
});
