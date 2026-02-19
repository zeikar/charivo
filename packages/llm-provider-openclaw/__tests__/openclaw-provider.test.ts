import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiMocks = vi.hoisted(() => {
  const instances: { config: unknown }[] = [];

  const createCompletion = vi.fn(
    async (_payload: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      max_tokens?: number;
    }) => ({
      choices: [
        {
          message: { content: "openclaw response" },
        },
      ],
    }),
  );

  class MockOpenAI {
    chat = {
      completions: {
        create: createCompletion,
      },
    };

    constructor(public config: unknown) {
      instances.push(this);
    }
  }

  return { createCompletion, MockOpenAI, instances };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
  openaiMocks.instances.length = 0;
});

describe("OpenClawLLMProvider", () => {
  it("sets correct baseURL and x-openclaw-agent-id header by default", () => {
    new OpenClawLLMProvider({
      token: "test-token",
      dangerouslyAllowBrowser: true,
    });

    expect(openaiMocks.instances).toHaveLength(1);
    expect(openaiMocks.instances[0]!.config).toMatchObject({
      apiKey: "test-token",
      baseURL: "http://127.0.0.1:18789/v1",
      defaultHeaders: { "x-openclaw-agent-id": "main" },
    });
  });

  it("uses custom baseURL and agentId when provided", () => {
    new OpenClawLLMProvider({
      token: "my-token",
      baseURL: "http://192.168.1.10:9000/v1",
      agentId: "assistant",
      dangerouslyAllowBrowser: true,
    });

    expect(openaiMocks.instances[0]!.config).toMatchObject({
      apiKey: "my-token",
      baseURL: "http://192.168.1.10:9000/v1",
      defaultHeaders: { "x-openclaw-agent-id": "assistant" },
    });
  });

  it("forwards messages and returns response", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      model: "openclaw",
      dangerouslyAllowBrowser: true,
    });

    const result = await provider.generateResponse([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "hello" },
    ]);

    expect(result).toBe("openclaw response");
    expect(openaiMocks.createCompletion).toHaveBeenCalledTimes(1);
    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.model).toBe("openclaw");
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "hello" },
    ]);
  });

  it("uses default model 'openclaw' when not specified", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.model).toBe("openclaw");
  });

  it("wraps errors with OpenClaw prefix", async () => {
    openaiMocks.createCompletion.mockRejectedValueOnce(new Error("timeout"));

    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toThrow("OpenClaw LLM Error: timeout");
  });
});
