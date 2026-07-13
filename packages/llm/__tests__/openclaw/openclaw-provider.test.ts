import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharivoProviderError } from "@charivo/core";

const openaiMocks = vi.hoisted(() => {
  const instances: { config: unknown }[] = [];

  const createCompletion = vi.fn(
    async (_payload: {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      max_tokens?: number;
      user?: string;
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

import { OpenClawLLMProvider } from "../../src/openclaw/provider";

beforeEach(() => {
  openaiMocks.createCompletion.mockClear();
  openaiMocks.instances.length = 0;
});

describe("OpenClawLLMProvider", () => {
  it("omits the agent header when no agentId is given", () => {
    new OpenClawLLMProvider({
      token: "test-token",
      dangerouslyAllowBrowser: true,
    });

    const config = openaiMocks.instances[0]!.config as {
      defaultHeaders?: Record<string, string>;
    };
    expect(config).toMatchObject({
      apiKey: "test-token",
      baseURL: "http://127.0.0.1:18789/v1",
    });
    // No agentId: let the gateway route to its configured default agent.
    // Forcing "main" here 400s on gateways without a "main" agent.
    expect(config.defaultHeaders).toBeUndefined();
  });

  it("sends the agent header when agentId is provided", () => {
    new OpenClawLLMProvider({
      token: "my-token",
      baseURL: "http://192.168.1.10:9000/v1",
      agentId: "assistant",
      dangerouslyAllowBrowser: true,
    });

    expect(openaiMocks.instances[0]!.config).toMatchObject({
      baseURL: "http://192.168.1.10:9000/v1",
      defaultHeaders: { "x-openclaw-agent-id": "assistant" },
    });
  });

  it("uses default model 'openclaw/default' when not specified", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    const result = await provider.generateResponse([
      { role: "user", content: "hi" },
    ]);

    expect(result).toBe("openclaw response");
    expect(openaiMocks.createCompletion.mock.calls[0]![0].model).toBe(
      "openclaw/default",
    );
  });

  it("sends the full history when no session is pinned", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    const history = [
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "latest question" },
    ];

    await provider.generateResponse(history);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual(history);
    expect(payload.user).toBeUndefined();
  });

  it("sends sessionKey as the user field to pin the gateway session", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([{ role: "user", content: "hi" }]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.user).toBe("conversation-abc");
  });

  it("sends only system prompts and the latest turn when a session is pinned", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "latest question" },
    ]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    // The gateway already holds the past turns for this session; resending them
    // would inject a duplicate copy of the history on top of its own.
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "latest question" },
    ]);
  });

  it("sends only system prompts when the latest message is a system message", async () => {
    const provider = new OpenClawLLMProvider({
      token: "token",
      sessionKey: "conversation-abc",
      dangerouslyAllowBrowser: true,
    });

    await provider.generateResponse([
      { role: "system", content: "You are Hiyori" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "system", content: "Session reset notice" },
    ]);

    const payload = openaiMocks.createCompletion.mock.calls[0]![0];
    expect(payload.messages).toEqual([
      { role: "system", content: "You are Hiyori" },
      { role: "system", content: "Session reset notice" },
    ]);
  });

  it("wraps request failures as CharivoProviderError", async () => {
    openaiMocks.createCompletion.mockRejectedValueOnce(new Error("timeout"));

    const provider = new OpenClawLLMProvider({
      token: "token",
      dangerouslyAllowBrowser: true,
    });

    await expect(
      provider.generateResponse([{ role: "user", content: "hi" }]),
    ).rejects.toThrow(CharivoProviderError);
  });
});
