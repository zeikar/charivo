import { describe, expect, it, vi } from "vitest";
import type {
  Character,
  CharivoEventEmitter,
  LLMCallOptions,
  LLMClient,
  LLMMessage,
  LLMToolCall,
  LLMToolResponse,
  Message,
  ToolDefinition,
  ToolHandler,
  ToolRegistration,
  ToolResultProjector,
} from "@charivo/core";
import { CharivoStateError } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { CharacterPromptBuilder } from "../src/character-prompt-builder";
import { LLMValidators } from "../src/validators";
import { LLMManager } from "../src/llm-manager";
import { MessageConverter } from "../src/message-converter";
import { MessageHistoryManager } from "../src/message-history-manager";
import { ResponseMessageBuilder } from "../src/response-message-builder";

const character: Character = {
  id: "char-1",
  name: "Hiyori",
  description: "A cheerful assister",
  personality: "Optimistic",
};

class MockClient implements LLMClient {
  call = vi.fn(
    async (messages: Array<{ role: string; content: string }>) =>
      messages[messages.length - 1]?.content.toUpperCase() ?? "",
  );
}

const buildUserMessage = (content: string): Message => ({
  id: `msg-${content}`,
  content,
  timestamp: new Date("2024-01-01T00:00:00Z"),
  type: "user",
});

// Every message carries the same id, so a rollback that keys on the id
// cannot tell two turns apart.
const buildDuplicateIdMessage = (content: string): Message => ({
  id: "duplicate-id",
  content,
  timestamp: new Date("2024-01-01T00:00:00Z"),
  type: "user",
});

describe("CharacterPromptBuilder", () => {
  it("builds descriptive system prompts", () => {
    const prompt = CharacterPromptBuilder.buildSystemPrompt(character);
    expect(prompt).toContain("You are Hiyori.");
    expect(prompt).toContain("cheerful assister");
  });

  it("falls back to default when character missing", () => {
    const prompt = CharacterPromptBuilder.buildSystemPromptOrDefault();
    expect(prompt).toContain("You are a helpful assistant.");
    expect(prompt).toContain(
      "Respond naturally in plain text with no bracketed emotion tags or control markup.",
    );
  });
});

describe("MessageHistoryManager", () => {
  const buildMessage = (id: string): Message => ({
    id,
    content: id,
    timestamp: new Date(),
    type: "user",
  });

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

  it("keeps existing unbounded behavior by default", () => {
    const manager = new MessageHistoryManager();

    for (let index = 1; index <= 5; index += 1) {
      manager.add(buildMessage(String(index)));
    }

    expect(manager.getAll()).toHaveLength(5);
    expect(manager.getAll().map((message) => message.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("prunes old messages in FIFO order when a message limit is set", () => {
    const manager = new MessageHistoryManager({ maxMessages: 3 });

    for (let index = 1; index <= 5; index += 1) {
      manager.add(buildMessage(String(index)));
    }

    expect(manager.getAll().map((message) => message.id)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("respects pruneBatchSize when removing oldest messages", () => {
    const manager = new MessageHistoryManager({
      maxMessages: 4,
      pruneBatchSize: 2,
    });

    for (let index = 1; index <= 5; index += 1) {
      manager.add(buildMessage(String(index)));
    }

    expect(manager.getAll().map((message) => message.id)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("rejects invalid getRecent limits", () => {
    const manager = new MessageHistoryManager();

    expect(() => manager.getRecent(0)).toThrow(
      "maxMessages must be a positive integer",
    );
    expect(() => manager.getRecent(-1)).toThrow(
      "maxMessages must be a positive integer",
    );
    expect(() => manager.getRecent(1.5)).toThrow(
      "maxMessages must be a positive integer",
    );
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

describe("LLMClient contract", () => {
  it("still accepts an implementation using the pre-signal one-arg call signature", () => {
    // Compile-time regression guard for the optional `options?: LLMCallOptions`
    // param added to `LLMClient.call`: a client implemented against the old
    // one-arg `call(messages)` signature must still assign to `LLMClient`.
    // vitest transpiles without typechecking, so this guard is enforced by
    // `tsc -p tsconfig.test.json` (the root `pnpm typecheck` includes
    // `typecheck:tests`), not by running this test.
    const oneArgClient: LLMClient = {
      call: (_messages: Array<{ role: string; content: string }>) =>
        Promise.resolve(""),
    };

    expect(oneArgClient).toBeDefined();
  });
});

describe("LLMManager", () => {
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

  it("forwards options.signal to the client call", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const controller = new AbortController();
    await manager.generateResponse(buildUserMessage("hello"), {
      signal: controller.signal,
    });

    expect(client.call).toHaveBeenCalledWith(expect.any(Array), {
      signal: controller.signal,
    });
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

  it("limits default history to the latest 40 turns", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client);

    manager.setCharacter(character);

    for (let index = 1; index <= 41; index += 1) {
      await manager.generateResponse(buildUserMessage(`turn-${index}`));
    }

    const history = manager.getHistory();
    expect(history).toHaveLength(80);
    expect(history[0]).toMatchObject({
      type: "user",
      content: "turn-2",
    });
    expect(history[history.length - 1]).toMatchObject({
      type: "character",
      content: "TURN-41",
    });
  });

  it("keeps turn boundaries when pruning to one turn", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: 1 });

    manager.setCharacter(character);

    await manager.generateResponse(buildUserMessage("first"));
    await manager.generateResponse(buildUserMessage("second"));

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "second",
      "SECOND",
    ]);
    expect(manager.getHistory().map((message) => message.type)).toEqual([
      "user",
      "character",
    ]);
  });

  it("sends a bounded API context without a leading character message", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: 1 });

    manager.setCharacter(character);

    await manager.generateResponse(buildUserMessage("first"));
    await manager.generateResponse(buildUserMessage("second"));

    const secondCallMessages = client.call.mock.calls[1]![0];
    expect(secondCallMessages).toEqual([
      {
        role: "system",
        content: expect.stringContaining("You are Hiyori"),
      },
      {
        role: "user",
        content: "second",
      },
    ]);
  });

  it("does not lose messages below the configured limit", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: 40 });

    manager.setCharacter(character);

    for (let index = 1; index <= 15; index += 1) {
      await manager.generateResponse(buildUserMessage(`turn-${index}`));
    }

    expect(manager.getHistory()).toHaveLength(30);
    expect(manager.getHistory()[0]).toMatchObject({
      type: "user",
      content: "turn-1",
    });
  });

  it("rolls back only the in-flight user message when a bounded call fails", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: 1 });

    manager.setCharacter(character);
    await manager.generateResponse(buildUserMessage("first"));

    const error = new Error("network");
    client.call.mockRejectedValueOnce(error);

    await expect(
      manager.generateResponse(buildUserMessage("second")),
    ).rejects.toThrowError(error);

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "first",
      "FIRST",
    ]);
  });

  it("keeps history bounded after a failed call is retried", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: 1 });

    manager.setCharacter(character);
    await manager.generateResponse(buildUserMessage("first"));

    const error = new Error("network");
    client.call.mockRejectedValueOnce(error);
    await expect(
      manager.generateResponse(buildUserMessage("second")),
    ).rejects.toThrowError(error);

    await manager.generateResponse(buildUserMessage("second"));

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "second",
      "SECOND",
    ]);
  });

  it("can opt out of bounded history", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client, { maxHistoryTurns: null });

    manager.setCharacter(character);

    for (let index = 1; index <= 41; index += 1) {
      await manager.generateResponse(buildUserMessage(`turn-${index}`));
    }

    expect(manager.getHistory()).toHaveLength(82);
  });

  it("rejects invalid maxHistoryTurns values", () => {
    const client = new MockClient();

    expect(() => createLLMManager(client, { maxHistoryTurns: 0 })).toThrow(
      "maxHistoryTurns must be a positive integer or null",
    );
    expect(() => createLLMManager(client, { maxHistoryTurns: -1 })).toThrow(
      "maxHistoryTurns must be a positive integer or null",
    );
    expect(() => createLLMManager(client, { maxHistoryTurns: 1.5 })).toThrow(
      "maxHistoryTurns must be a positive integer or null",
    );
    expect(() => createLLMManager(client, { maxHistoryTurns: NaN })).toThrow(
      "maxHistoryTurns must be a positive integer or null",
    );
  });

  /**
   * Client whose calls stay pending until the test settles them, so two
   * overlapping generateResponse calls can be finished in either order.
   */
  class DeferredClient implements LLMClient {
    readonly pending: Array<{
      resolve: (value: string) => void;
      reject: (reason: unknown) => void;
    }> = [];

    call = vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          this.pending.push({ resolve, reject });
        }),
    );
  }

  it("rolls back the failing turn's own message when the earlier turn fails", async () => {
    const client = new DeferredClient();
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const first = buildDuplicateIdMessage("A");
    const second = buildDuplicateIdMessage("B");
    const pendingFirst = manager.generateResponse(first);
    const pendingSecond = manager.generateResponse(second);

    client.pending[0]!.reject(new Error("network"));
    await expect(pendingFirst).rejects.toThrow("network");

    client.pending[1]!.resolve("Reply B");
    await expect(pendingSecond).resolves.toBe("Reply B");

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "B",
      "Reply B",
    ]);
  });

  it("rolls back the failing turn's own message when the later turn fails", async () => {
    const client = new DeferredClient();
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const first = buildDuplicateIdMessage("A");
    const second = buildDuplicateIdMessage("B");
    const pendingFirst = manager.generateResponse(first);
    const pendingSecond = manager.generateResponse(second);

    client.pending[1]!.reject(new Error("network"));
    await expect(pendingSecond).rejects.toThrow("network");

    client.pending[0]!.resolve("Reply A");
    await expect(pendingFirst).resolves.toBe("Reply A");

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "A",
      "Reply A",
    ]);
  });
});

describe("LLMManager caller-owned history", () => {
  const buildCharacterMessage = (content: string): Message => ({
    id: `ai-${content}`,
    content,
    timestamp: new Date("2024-01-01T00:00:00Z"),
    type: "character",
    characterId: character.id,
  });

  /** Bounded manager already holding one completed turn, i.e. at its bound. */
  const prefillBoundedManager = async () => {
    const manager = createLLMManager(new MockClient(), { maxHistoryTurns: 1 });
    manager.setCharacter(character);
    await manager.generateResponse(buildUserMessage("first"));

    return { manager, prefilled: manager.getHistory() };
  };

  it("rejects an empty user message with a state error and appends nothing", () => {
    const manager = createLLMManager(new MockClient());
    manager.setCharacter(character);

    let thrown: unknown;
    try {
      manager.addToHistory(buildUserMessage(""));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CharivoStateError);
    expect((thrown as CharivoStateError).code).toBe("CHARIVO_STATE_ERROR");
    expect(manager.getHistory()).toEqual([]);
  });

  it("stores an empty character message exactly as produced", () => {
    const manager = createLLMManager(new MockClient());
    manager.setCharacter(character);

    const reply = buildCharacterMessage("");
    manager.addToHistory(reply);

    expect(manager.getHistory()).toEqual([reply]);
  });

  it("appends within the configured bound and returns a callable handle", () => {
    const manager = createLLMManager(new MockClient(), { maxHistoryTurns: 1 });
    manager.setCharacter(character);

    for (const content of ["one", "two", "three"]) {
      expect(typeof manager.addToHistory(buildUserMessage(content))).toBe(
        "function",
      );
    }

    expect(manager.getHistory().map((message) => message.content)).toEqual([
      "two",
      "three",
    ]);
  });

  it("appends a message once and re-appends it after a clear", () => {
    const manager = createLLMManager(new MockClient());
    manager.setCharacter(character);
    const message = buildUserMessage("hello");

    manager.addToHistory(message);
    manager.addToHistory(message);
    expect(manager.getHistory()).toEqual([message]);

    manager.clearHistory();
    manager.addToHistory(message);
    expect(manager.getHistory()).toEqual([message]);
  });

  it("keeps a duplicate call inert so it cannot damage the first handle", async () => {
    const { manager, prefilled } = await prefillBoundedManager();
    const message = buildUserMessage("second");

    const rollback = manager.addToHistory(message);
    const duplicateRollback = manager.addToHistory(message);

    duplicateRollback();
    expect(manager.getHistory()).toEqual([message]);

    rollback();
    expect(manager.getHistory()).toEqual(prefilled);
  });

  it("restores exactly what its append evicted and stays idempotent", async () => {
    const { manager, prefilled } = await prefillBoundedManager();
    const message = buildUserMessage("second");

    const rollback = manager.addToHistory(message);
    expect(manager.getHistory()).toEqual([message]);

    rollback();
    expect(manager.getHistory()).toEqual(prefilled);

    // A spent handle stays inert even when the caller legitimately re-adds the
    // message it rolled back.
    manager.addToHistory(message);
    rollback();
    expect(manager.getHistory()).toEqual([message]);
  });

  it("does not resurrect evicted messages after an intervening write", async () => {
    const { manager } = await prefillBoundedManager();
    const rollback = manager.addToHistory(buildUserMessage("second"));

    manager.clearHistory();
    rollback();

    expect(manager.getHistory()).toEqual([]);
  });

  it("binds each handle to its own message object, in either order", () => {
    // Duplicate ids: only reference identity can tell these two apart.
    const earlierManager = createLLMManager(new MockClient());
    earlierManager.setCharacter(character);
    const earlierFirst = buildDuplicateIdMessage("A");
    const earlierSecond = buildDuplicateIdMessage("B");
    const rollbackEarlier = earlierManager.addToHistory(earlierFirst);
    earlierManager.addToHistory(earlierSecond);

    rollbackEarlier();
    expect(earlierManager.getHistory()).toEqual([earlierSecond]);

    const laterManager = createLLMManager(new MockClient());
    laterManager.setCharacter(character);
    const laterFirst = buildDuplicateIdMessage("A");
    const laterSecond = buildDuplicateIdMessage("B");
    laterManager.addToHistory(laterFirst);
    const rollbackLater = laterManager.addToHistory(laterSecond);

    rollbackLater();
    expect(laterManager.getHistory()).toEqual([laterFirst]);
  });

  it("never strands an orphan reply at the head when pruning", () => {
    const manager = createLLMManager(new MockClient(), { maxHistoryTurns: 1 });
    manager.setCharacter(character);

    const userA = buildUserMessage("A");
    const replyA = buildCharacterMessage("Reply A");
    const userB = buildUserMessage("B");

    manager.addToHistory(userA);
    manager.addToHistory(replyA); // at the bound
    manager.addToHistory(userB); // evicts userA, stranding replyA at the head

    expect(manager.getHistory()).toEqual([userB]);
  });

  it("keeps the message it was asked to store when the window is all replies", () => {
    const manager = createLLMManager(new MockClient(), { maxHistoryTurns: 1 });
    manager.setCharacter(character);

    manager.addToHistory(buildUserMessage("A"));
    manager.addToHistory(buildCharacterMessage("Reply A"));
    const followUp = buildCharacterMessage("Follow up");
    manager.addToHistory(followUp);

    expect(manager.getHistory()).toEqual([followUp]);
  });

  it("preserves a character message appended to an empty history", () => {
    const manager = createLLMManager(new MockClient(), { maxHistoryTurns: 1 });
    manager.setCharacter(character);

    const greeting = buildCharacterMessage("Hello there");
    manager.addToHistory(greeting);

    expect(manager.getHistory()).toEqual([greeting]);
  });

  it("writes no history when the caller owns it", async () => {
    const client = new MockClient();
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const message = buildUserMessage("hello");
    manager.addToHistory(message);

    await expect(
      manager.generateResponse(message, { callerOwnsHistory: true }),
    ).resolves.toBe("HELLO");

    expect(client.call.mock.calls[0]![0]).toEqual([
      { role: "system", content: expect.stringContaining("You are Hiyori") },
      { role: "user", content: "hello" },
    ]);
    expect(manager.getHistory()).toEqual([message]);
  });

  it("keeps the caller's message in history when a caller-owned call fails", async () => {
    const client = new MockClient();
    client.call.mockRejectedValueOnce(new Error("network"));
    const manager = createLLMManager(client);
    manager.setCharacter(character);

    const message = buildUserMessage("hello");
    manager.addToHistory(message);

    await expect(
      manager.generateResponse(message, { callerOwnsHistory: true }),
    ).rejects.toThrow("network");

    expect(manager.getHistory()).toEqual([message]);
  });
});

describe("LLMManager tool loop", () => {
  const FINAL_TEXT = "Here you go!";

  const buildUserMessage = (content: string): Message => ({
    id: `msg-${content}`,
    content,
    timestamp: new Date("2024-01-01T00:00:00Z"),
    type: "user",
  });

  const buildPlainClient = () => ({
    call: vi.fn(
      async (messages: Array<{ role: string; content: string }>) =>
        messages[messages.length - 1]?.content.toUpperCase() ?? "",
    ),
  });

  /**
   * Tool-capable fake client. Queued responses are returned in order; the
   * message payloads are snapshotted per call because the manager mutates the
   * working conversation in place.
   */
  const buildToolClient = (responses: LLMToolResponse[]) => {
    const queue = [...responses];
    const payloads: LLMMessage[][] = [];
    const toolPayloads: ToolDefinition[][] = [];

    const call = vi.fn(
      async (messages: Array<{ role: string; content: string }>) =>
        messages[messages.length - 1]?.content.toUpperCase() ?? "",
    );
    const callWithTools = vi.fn(
      async (
        messages: LLMMessage[],
        tools: ToolDefinition[],
        _options?: LLMCallOptions,
      ): Promise<LLMToolResponse> => {
        payloads.push([...messages]);
        toolPayloads.push(tools);
        return queue.shift() ?? { content: FINAL_TEXT };
      },
    );

    const client: LLMClient = { call, callWithTools };

    return { client, call, callWithTools, payloads, toolPayloads };
  };

  const expressionDefinition: ToolDefinition = {
    type: "function",
    name: "setExpression",
    description: "Change the avatar expression",
    parameters: {
      type: "object",
      properties: {
        expressionId: { type: "string", enum: ["smile", "sad"] },
      },
      required: ["expressionId"],
    },
  };

  const buildExpressionTool = (handler: ToolHandler): ToolRegistration => ({
    definition: expressionDefinition,
    handler,
  });

  const expressionHandler: ToolHandler = async (args) => ({
    success: true,
    expressionId: args.expressionId,
  });

  const buildToolCall = (
    args: Record<string, unknown> = { expressionId: "smile" },
    name = "setExpression",
  ): LLMToolCall => ({
    id: "call-1",
    name,
    arguments: args,
  });

  const expressionProjector: ToolResultProjector = ({ name, output, emit }) => {
    if (name === "setExpression" && typeof output.expressionId === "string") {
      emit("avatar:expression", { expressionId: output.expressionId });
    }
  };

  const buildEmitterSpy = () => {
    const emit = vi.fn();
    const eventEmitter: CharivoEventEmitter = { emit };
    return { eventEmitter, emit };
  };

  const readToolTurn = (messages: LLMMessage[]) => {
    const toolTurn = messages.find((message) => message.role === "tool");
    expect(toolTurn).toBeDefined();
    return JSON.parse(toolTurn!.content) as Record<string, unknown>;
  };

  it("keeps the plain call path when the client cannot call tools", async () => {
    const client = buildPlainClient();
    const handler = vi.fn(expressionHandler);
    // Uses the factory (core's optional-tool interface) since this test only
    // needs generateResponse; the other tests below call registerTool/
    // getRegisteredTools directly and need LLMManager's non-optional members.
    const manager = createLLMManager(client, {
      tools: [buildExpressionTool(handler)],
      toolInstructions: "Use avatar tools when it fits.",
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe("HELLO");
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();

    const systemMessage = client.call.mock.calls[0]![0][0]!;
    expect(systemMessage.content).not.toContain(
      "Use avatar tools when it fits.",
    );
    expect(manager.getHistory()).toHaveLength(2);
  });

  it("executes a tool round and returns the follow-up text", async () => {
    const toolCall = buildToolCall();
    const { client, callWithTools, payloads, toolPayloads } = buildToolClient([
      { content: "", toolCalls: [toolCall] },
      { content: FINAL_TEXT },
    ]);
    const handler = vi.fn(expressionHandler);
    const { eventEmitter, emit } = buildEmitterSpy();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(handler)],
      resultProjectors: [expressionProjector],
    });

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(callWithTools).toHaveBeenCalledTimes(2);
    expect(toolPayloads[0]).toEqual([expressionDefinition]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { expressionId: "smile" },
      { character, callId: "call-1" },
    );

    expect(emit).toHaveBeenCalledWith("avatar:expression", {
      expressionId: "smile",
    });
    expect(emit).toHaveBeenCalledWith("tool:call", {
      name: "setExpression",
      args: { expressionId: "smile" },
      callId: "call-1",
    });
    expect(emit).toHaveBeenCalledWith("tool:result", {
      name: "setExpression",
      output: { success: true, expressionId: "smile" },
      callId: "call-1",
    });

    expect(payloads[0]).toEqual([
      { role: "system", content: expect.stringContaining("You are Hiyori") },
      { role: "user", content: "hello" },
    ]);
    expect(payloads[1]!.slice(2)).toEqual([
      { role: "assistant", content: "", toolCalls: [toolCall] },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({ success: true, expressionId: "smile" }),
      },
    ]);

    expect(
      manager.getHistory().map((message) => [message.type, message.content]),
    ).toEqual([
      ["user", "hello"],
      ["character", FINAL_TEXT],
    ]);
  });

  it("executes multiple tool calls from a single round in order", async () => {
    const toolCallOne: LLMToolCall = {
      id: "call-1",
      name: "setExpression",
      arguments: { expressionId: "smile" },
    };
    const toolCallTwo: LLMToolCall = {
      id: "call-2",
      name: "setExpression",
      arguments: { expressionId: "sad" },
    };
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [toolCallOne, toolCallTwo] },
      { content: FINAL_TEXT },
    ]);
    const handler = vi.fn(expressionHandler);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(handler)],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(
      1,
      { expressionId: "smile" },
      { character, callId: "call-1" },
    );
    expect(handler).toHaveBeenNthCalledWith(
      2,
      { expressionId: "sad" },
      { character, callId: "call-2" },
    );

    const toolTurns = payloads[1]!.filter((message) => message.role === "tool");
    expect(toolTurns).toEqual([
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({ success: true, expressionId: "smile" }),
      },
      {
        role: "tool",
        toolCallId: "call-2",
        content: JSON.stringify({ success: true, expressionId: "sad" }),
      },
    ]);
  });

  it("skips the handler and returns a failure output on invalid arguments", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall({})] },
      { content: FINAL_TEXT },
    ]);
    const handler = vi.fn(expressionHandler);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(handler)],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(handler).not.toHaveBeenCalled();
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error:
        'LLM tool "setExpression" arguments failed schema validation: missing required property "expressionId"',
    });
  });

  it("converts a throwing handler into a failure output", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const manager = new LLMManager(client, {
      tools: [
        buildExpressionTool(async () => {
          throw new Error("handler exploded");
        }),
      ],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: "handler exploded",
    });
  });

  it("converts a timed out handler into a failure output", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const manager = new LLMManager(client, {
      tools: [
        {
          ...buildExpressionTool(() => new Promise<never>(() => {})),
          timeoutMs: 1,
        },
      ],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: 'LLM tool "setExpression" timed out after 1ms',
    });
  });

  it("falls back to the manager's default tool timeout when a tool sets none", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(() => new Promise<never>(() => {}))],
      defaultToolTimeoutMs: 1,
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: 'LLM tool "setExpression" timed out after 1ms',
    });
  });

  it("converts a non-object handler result into a failure output", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const manager = new LLMManager(client, {
      tools: [
        buildExpressionTool(
          (async () => "not an object") as unknown as ToolHandler,
        ),
      ],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: 'LLM tool "setExpression" must return an object',
    });
  });

  it("converts an unknown tool name into a failure output", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall({}, "playMotion")] },
      { content: FINAL_TEXT },
    ]);
    const { eventEmitter, emit } = buildEmitterSpy();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(expressionHandler)],
    });

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: 'No LLM tool registered for "playMotion"',
    });
    expect(emit).toHaveBeenCalledWith("tool:call", {
      name: "playMotion",
      args: {},
      callId: "call-1",
    });
    expect(emit).toHaveBeenCalledWith("tool:error", {
      name: "playMotion",
      error: new Error('No LLM tool registered for "playMotion"'),
      callId: "call-1",
    });
    expect(
      emit.mock.calls.filter(([event]) => event === "tool:result"),
    ).toEqual([]);
  });

  it("stops executing tools after the round cap", async () => {
    const toolCall = buildToolCall();
    const { client, callWithTools, toolPayloads } = buildToolClient([
      { content: "", toolCalls: [toolCall] },
      { content: "", toolCalls: [toolCall] },
      { content: "", toolCalls: [toolCall] },
      { content: FINAL_TEXT, toolCalls: [toolCall] },
    ]);
    const handler = vi.fn(expressionHandler);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(handler)],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(callWithTools).toHaveBeenCalledTimes(4);
    expect(handler).toHaveBeenCalledTimes(3);
    // The terminal call forces text by offering no tools.
    expect(toolPayloads[3]).toEqual([]);
  });

  it("forwards the same signal to every round of the tool loop", async () => {
    const toolCall = buildToolCall();
    const { client, callWithTools } = buildToolClient([
      { content: "", toolCalls: [toolCall] },
      { content: "", toolCalls: [toolCall] },
      { content: "", toolCalls: [toolCall] },
      { content: FINAL_TEXT, toolCalls: [toolCall] },
    ]);
    const handler = vi.fn(expressionHandler);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(handler)],
    });

    manager.setCharacter(character);

    const controller = new AbortController();
    const response = await manager.generateResponse(buildUserMessage("hello"), {
      signal: controller.signal,
    });

    expect(response).toBe(FINAL_TEXT);
    // Initial call plus every follow-up round of the tool loop.
    expect(callWithTools).toHaveBeenCalledTimes(4);
    for (const call of callWithTools.mock.calls) {
      expect(call[2]).toEqual({ signal: controller.signal });
    }
  });

  it("appends tool instructions to the system prompt on the tools path", async () => {
    const { client, payloads } = buildToolClient([{ content: FINAL_TEXT }]);
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(expressionHandler)],
      toolInstructions: "Use avatar tools when it fits.",
    });

    manager.setCharacter(character);

    await manager.generateResponse(buildUserMessage("hello"));

    const systemMessage = payloads[0]![0]!;
    expect(systemMessage.content).toContain("You are Hiyori");
    expect(
      systemMessage.content.endsWith("\n\nUse avatar tools when it fits."),
    ).toBe(true);

    manager.setToolInstructions(null);
    await manager.generateResponse(buildUserMessage("again"));

    expect(payloads[1]![0]!.content).not.toContain(
      "Use avatar tools when it fits.",
    );
  });

  it("skips projection when no event emitter is set", async () => {
    const { client } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const projector = vi.fn();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(expressionHandler)],
      resultProjectors: [projector],
    });

    manager.setCharacter(character);

    await expect(
      manager.generateResponse(buildUserMessage("hello")),
    ).resolves.toBe(FINAL_TEXT);
    expect(projector).not.toHaveBeenCalled();
  });

  it("surfaces a throwing projector as an llm:error event", async () => {
    const { client } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const { eventEmitter, emit } = buildEmitterSpy();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(expressionHandler)],
      resultProjectors: [
        () => {
          throw new Error("projector exploded");
        },
      ],
    });

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(emit).toHaveBeenCalledWith("llm:error", {
      error: new Error(
        'LLM result projector failed for tool "setExpression": projector exploded',
      ),
    });
  });

  it("hands the same snapshot to the event, the projectors, and the tool turn", async () => {
    const { client, payloads } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const result: Record<string, unknown> = {
      success: true,
      startedAt: new Date("2024-01-01T00:00:00Z"),
      toJSON: () => ({ success: true, expressionId: "smile" }),
    };
    const projectedOutputs: Array<Record<string, unknown>> = [];
    const projector: ToolResultProjector = ({ output }) => {
      projectedOutputs.push(output);
    };
    const { eventEmitter, emit } = buildEmitterSpy();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(async () => result)],
      resultProjectors: [projector],
    });

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);

    // The event carries the JSON round-trip, matching what realtime emits.
    expect(emit).toHaveBeenCalledWith("tool:result", {
      name: "setExpression",
      output: { success: true, expressionId: "smile" },
      callId: "call-1",
    });

    // Projectors receive that same snapshot, never the live handler object.
    expect(projectedOutputs).toHaveLength(1);
    expect(projectedOutputs[0]).not.toBe(result);
    expect(projectedOutputs[0]).toEqual({
      success: true,
      expressionId: "smile",
    });

    expect(readToolTurn(payloads[1]!)).toEqual({
      success: true,
      expressionId: "smile",
    });
  });

  it("gives projectors the JSON form of non-JSON handler values", async () => {
    const { client } = buildToolClient([
      { content: "", toolCalls: [buildToolCall()] },
      { content: FINAL_TEXT },
    ]);
    const result: Record<string, unknown> = {
      success: true,
      startedAt: new Date("2024-01-01T00:00:00Z"),
      skipped: undefined,
    };
    const projectedOutputs: Array<Record<string, unknown>> = [];
    const projector: ToolResultProjector = ({ output }) => {
      projectedOutputs.push(output);
    };
    const { eventEmitter } = buildEmitterSpy();
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(async () => result)],
      resultProjectors: [projector],
    });

    // Projection is skipped entirely without an event emitter.
    manager.setEventEmitter(eventEmitter);
    manager.setCharacter(character);

    await manager.generateResponse(buildUserMessage("hello"));

    // A Date becomes its ISO string and an undefined property disappears —
    // the same values a realtime projector sees, and the documented cost of
    // projecting the wire form rather than the live object.
    expect(projectedOutputs).toEqual([
      { success: true, startedAt: "2024-01-01T00:00:00.000Z" },
    ]);
  });

  it("converts unserializable tool outputs into failure outputs", async () => {
    const circular: Record<string, unknown> = { success: true };
    circular.self = circular;

    const cases: Array<{ label: string; result: Record<string, unknown> }> = [
      { label: "bigint", result: { success: true, amount: 1n } },
      { label: "circular", result: circular },
      {
        label: "toJSON-undefined",
        result: { success: true, toJSON: () => undefined },
      },
      // The snapshot recheck catches a toJSON() that is serializable but is not
      // an object, so it degrades here instead of escaping through the event.
      {
        label: "toJSON-primitive",
        result: { success: true, toJSON: () => "not an object" },
      },
    ];

    for (const { label, result } of cases) {
      const { client, payloads } = buildToolClient([
        { content: "", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      const projector = vi.fn();
      const { eventEmitter, emit } = buildEmitterSpy();
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(async () => result)],
        resultProjectors: [projector],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
      );

      expect(response, label).toBe(FINAL_TEXT);
      expect(projector, label).not.toHaveBeenCalled();

      expect(
        emit.mock.calls.filter(([event]) => event === "tool:result"),
        label,
      ).toEqual([]);
      expect(emit, label).toHaveBeenCalledWith("tool:error", {
        name: "setExpression",
        error: expect.any(Error),
        callId: "call-1",
      });

      const output = readToolTurn(payloads[1]!);
      expect(output.success, label).toBe(false);
      expect(typeof output.error, label).toBe("string");

      expect(
        manager.getHistory().map((message) => message.type),
        label,
      ).toEqual(["user", "character"]);
    }
  });

  it("registers and unregisters tools after construction", async () => {
    const { client, call, callWithTools } = buildToolClient([
      { content: FINAL_TEXT },
    ]);
    const manager = new LLMManager(client);

    manager.setCharacter(character);
    expect(manager.getRegisteredTools()).toEqual([]);

    manager.registerTool(buildExpressionTool(expressionHandler));
    expect(manager.getRegisteredTools()).toEqual([expressionDefinition]);

    await manager.generateResponse(buildUserMessage("hello"));
    expect(callWithTools).toHaveBeenCalledTimes(1);

    manager.unregisterTool("setExpression");
    expect(manager.getRegisteredTools()).toEqual([]);

    await manager.generateResponse(buildUserMessage("again"));
    expect(call).toHaveBeenCalledTimes(1);
    expect(callWithTools).toHaveBeenCalledTimes(1);
  });

  describe("cancellation", () => {
    const sadToolCall: LLMToolCall = {
      id: "call-2",
      name: "setExpression",
      arguments: { expressionId: "sad" },
    };

    const emittedEvents = (emit: ReturnType<typeof vi.fn>): string[] =>
      emit.mock.calls.map(([event]) => event as string);

    /**
     * Emitter whose listener runs synchronously inside emit(), like the real
     * bus, so an event listener can supersede the turn mid-flight.
     */
    const buildCancellingEmitter = (
      cancelOn: string,
      cancel: () => void,
    ): {
      eventEmitter: CharivoEventEmitter;
      emit: ReturnType<typeof vi.fn>;
    } => {
      const emit = vi.fn((event: string) => {
        if (event === cancelOn) {
          cancel();
        }
      });
      return { eventEmitter: { emit }, emit };
    };

    it("stops a round at the tool call that follows the superseding handler", async () => {
      const { client, callWithTools } = buildToolClient([
        { content: "partial", toolCalls: [buildToolCall(), sadToolCall] },
        { content: FINAL_TEXT },
      ]);
      let cancelled = false;
      const handler = vi.fn(async (args: Record<string, unknown>) => {
        cancelled = true;
        return { success: true, expressionId: args.expressionId };
      });
      const { eventEmitter, emit } = buildEmitterSpy();
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(handler)],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => cancelled },
      );

      expect(response).toBe("partial");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        { expressionId: "smile" },
        { character, callId: "call-1" },
      );
      expect(
        emit.mock.calls.filter(([event]) => event === "tool:call"),
      ).toHaveLength(1);
      // A superseded turn issues no further request.
      expect(callWithTools).toHaveBeenCalledTimes(1);
      // The predicate governs tool work and projections only — never history
      // writes, which follow the caller-owned history contract instead. Without
      // this, an isCancelled gate added around the commit would pass the suite.
      expect(
        manager.getHistory().map((entry) => [entry.type, entry.content]),
      ).toEqual([
        ["user", "hello"],
        ["character", "partial"],
      ]);
    });

    it("skips the handler when a tool:call listener supersedes the turn", async () => {
      const { client, callWithTools } = buildToolClient([
        { content: "partial", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      let cancelled = false;
      const handler = vi.fn(expressionHandler);
      const { eventEmitter, emit } = buildCancellingEmitter("tool:call", () => {
        cancelled = true;
      });
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(handler)],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => cancelled },
      );

      expect(response).toBe("partial");
      expect(handler).not.toHaveBeenCalled();
      // tool:call records the attempted dispatch even though nothing ran.
      expect(
        emit.mock.calls.filter(([event]) => event === "tool:call"),
      ).toHaveLength(1);
      expect(
        emittedEvents(emit).filter(
          (event) => event === "tool:result" || event === "tool:error",
        ),
      ).toEqual([]);
      expect(callWithTools).toHaveBeenCalledTimes(1);
    });

    it("drops a projector's later emissions once its first one supersedes the turn", async () => {
      const { client } = buildToolClient([
        { content: "partial", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      let cancelled = false;
      const { eventEmitter, emit } = buildCancellingEmitter(
        "avatar:expression",
        () => {
          cancelled = true;
        },
      );
      const projector: ToolResultProjector = ({ emit: project }) => {
        project("avatar:expression", { expressionId: "smile" });
        project("avatar:motion", { group: "idle", index: 0 });
      };
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(expressionHandler)],
        resultProjectors: [projector],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => cancelled },
      );

      expect(response).toBe("partial");
      expect(emit).toHaveBeenCalledWith("avatar:expression", {
        expressionId: "smile",
      });
      expect(
        emit.mock.calls.filter(([event]) => event === "avatar:motion"),
      ).toEqual([]);
    });

    it("stops projecting at the projector that supersedes the turn", async () => {
      const { client } = buildToolClient([
        { content: "partial", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      let cancelled = false;
      const first = vi.fn(() => {
        cancelled = true;
      });
      const second = vi.fn();
      const { eventEmitter, emit } = buildEmitterSpy();
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(expressionHandler)],
        resultProjectors: [first, second],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => cancelled },
      );

      expect(response).toBe("partial");
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();
      // The handler ran, so its result is still reported.
      expect(emit).toHaveBeenCalledWith("tool:result", {
        name: "setExpression",
        output: { success: true, expressionId: "smile" },
        callId: "call-1",
      });
    });

    it("emits no llm:error for a projector that supersedes the turn and then throws", async () => {
      const { client } = buildToolClient([
        { content: "partial", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      let cancelled = false;
      const { eventEmitter, emit } = buildEmitterSpy();
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(expressionHandler)],
        resultProjectors: [
          () => {
            cancelled = true;
            throw new Error("projector exploded");
          },
        ],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => cancelled },
      );

      expect(response).toBe("partial");
      expect(
        emit.mock.calls.filter(([event]) => event === "llm:error"),
      ).toEqual([]);
    });

    it("leaves the multi-round tool flow unchanged when the predicate never cancels", async () => {
      const { client, callWithTools } = buildToolClient([
        { content: "", toolCalls: [buildToolCall()] },
        { content: "", toolCalls: [sadToolCall] },
        { content: FINAL_TEXT },
      ]);
      const handler = vi.fn(expressionHandler);
      const projector: ToolResultProjector = ({ output, emit: project }) => {
        project("avatar:expression", {
          expressionId: String(output.expressionId),
        });
        project("avatar:motion", { group: "idle", index: 0 });
      };
      const { eventEmitter, emit } = buildEmitterSpy();
      const manager = new LLMManager(client, {
        tools: [buildExpressionTool(handler)],
        resultProjectors: [projector],
      });

      manager.setEventEmitter(eventEmitter);
      manager.setCharacter(character);

      const response = await manager.generateResponse(
        buildUserMessage("hello"),
        { isCancelled: () => false },
      );

      expect(response).toBe(FINAL_TEXT);
      expect(callWithTools).toHaveBeenCalledTimes(3);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(
        emittedEvents(emit).filter((event) => event.startsWith("tool:")),
      ).toEqual(["tool:call", "tool:result", "tool:call", "tool:result"]);
      expect(emit).toHaveBeenCalledWith("avatar:expression", {
        expressionId: "smile",
      });
      expect(emit).toHaveBeenCalledWith("avatar:expression", {
        expressionId: "sad",
      });
      expect(
        emit.mock.calls.filter(([event]) => event === "avatar:motion"),
      ).toHaveLength(2);
    });
  });
});
