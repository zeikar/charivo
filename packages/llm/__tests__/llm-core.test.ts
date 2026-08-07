import { describe, expect, it, vi } from "vitest";
import type {
  Character,
  CharivoEventEmitter,
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

describe("LLMManager", () => {
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
    const manager = new LLMManager(client, {
      tools: [buildExpressionTool(expressionHandler)],
    });

    manager.setCharacter(character);

    const response = await manager.generateResponse(buildUserMessage("hello"));

    expect(response).toBe(FINAL_TEXT);
    expect(readToolTurn(payloads[1]!)).toEqual({
      success: false,
      error: 'No LLM tool registered for "playMotion"',
    });
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
    ];

    for (const { label, result } of cases) {
      const { client, payloads } = buildToolClient([
        { content: "", toolCalls: [buildToolCall()] },
        { content: FINAL_TEXT },
      ]);
      const projector = vi.fn();
      const { eventEmitter } = buildEmitterSpy();
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
});
