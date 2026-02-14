import { describe, expect, it, vi } from "vitest";
import type { Character, LLMClient, Message } from "@charivo/core";
import {
  CharacterPromptBuilder,
  LLMValidators,
  MessageConverter,
  MessageHistoryManager,
  ResponseMessageBuilder,
  createLLMManager,
} from "@charivo/llm-core";

const character: Character = {
  id: "char-1",
  name: "Hiyori",
  description: "A cheerful assister",
  personality: "Optimistic",
};

describe("CharacterPromptBuilder", () => {
  it("builds descriptive system prompts", () => {
    const prompt = CharacterPromptBuilder.buildSystemPrompt(character);
    expect(prompt).toContain("You are Hiyori.");
    expect(prompt).toContain("cheerful assister");
  });

  it("falls back to default when character missing", () => {
    const prompt = CharacterPromptBuilder.buildSystemPromptOrDefault();
    expect(prompt).toContain("You are a helpful assistant.");
    expect(prompt).toContain("IMPORTANT: Express emotions using ONLY");
  });
});

describe("MessageHistoryManager", () => {
  it("tracks messages in order", () => {
    const manager = new MessageHistoryManager();
    const first: Message = {
      id: "1",
      content: "hello",
      timestamp: new Date(),
      type: "user",
    };
    const second: Message = {
      id: "2",
      content: "hi",
      timestamp: new Date(),
      type: "character",
    };

    manager.add(first);
    manager.add(second);

    expect(manager.size()).toBe(2);
    expect(manager.getAll()).toEqual([first, second]);

    expect(manager.removeLast()).toEqual(second);
    expect(manager.size()).toBe(1);

    manager.clear();
    expect(manager.size()).toBe(0);
  });
});

describe("MessageConverter", () => {
  const message: Message = {
    id: "1",
    content: "hello",
    timestamp: new Date(),
    type: "user",
  };

  it("converts to OpenAI format", () => {
    expect(MessageConverter.toOpenAIFormat([message])).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  it("prepends system prompts", () => {
    const combined = MessageConverter.combineWithSystemPrompt("system", [
      message,
    ]);
    expect(combined[0]).toEqual({ role: "system", content: "system" });
    expect(combined[1]).toEqual({ role: "user", content: "hello" });
  });
});

describe("ResponseMessageBuilder", () => {
  it("creates character messages with defaults", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const response = ResponseMessageBuilder.create("Hi", "char-1");

    expect(response.type).toBe("character");
    expect(response.characterId).toBe("char-1");
    expect(response.id).toMatch(/^ai-\d+$/);
    expect(response.timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    vi.useRealTimers();
  });
});

describe("LLMValidators", () => {
  it("throws when character missing", () => {
    expect(() => LLMValidators.validateCharacterSet(null)).toThrow(
      "Character must be set before generating response",
    );
  });

  it("validates message content", () => {
    expect(() =>
      LLMValidators.validateMessage({
        id: "1",
        content: "hello",
        timestamp: new Date(),
        type: "user",
      }),
    ).not.toThrow();

    expect(() =>
      LLMValidators.validateMessage({
        id: "1",
        content: "",
        timestamp: new Date(),
        type: "user",
      }),
    ).toThrow("Message content must be a non-empty string");
  });
});

describe("LLMManager", () => {
  class MockClient implements LLMClient {
    call = vi.fn(
      async (messages: Array<{ role: string; content: string }>) =>
        messages[messages.length - 1]?.content.toUpperCase() ?? "",
    );
  }

  const buildUserMessage = (content: string): Message => ({
    id: "msg-1",
    content,
    timestamp: new Date("2024-01-01T00:00:00Z"),
    type: "user",
  });

  it("adds history and returns responses", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client);

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));
    expect(response).toBe("HELLO");
    expect(client.call).toHaveBeenCalledTimes(1);

    const callArg = client.call.mock.calls[0]![0];
    expect(callArg[0]).toEqual({
      role: "system",
      content: expect.stringContaining("You are Hiyori"),
    });
    expect(callArg[1]).toEqual({ role: "user", content: "hello" });

    const history = manager.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].type).toBe("user");
    expect(history[1].type).toBe("character");
  });

  it("clears history and current character", () => {
    const client = new MockClient();
    const manager = createLLMManager(client);

    manager.setCharacter(character);
    expect(manager.getCharacter()).toEqual(character);

    manager.clearHistory();
    expect(manager.getHistory()).toHaveLength(0);
  });

  it("throws when character missing", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client);

    await expect(
      manager.generateResponse(buildUserMessage("hi")),
    ).rejects.toThrow("Character must be set before generating response");
  });

  it("rolls back history when client fails", async () => {
    const client = new MockClient();
    const error = new Error("network");
    client.call.mockRejectedValueOnce(error);
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      manager.generateResponse(buildUserMessage("hi")),
    ).rejects.toThrowError(error);

    expect(manager.getHistory()).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});
