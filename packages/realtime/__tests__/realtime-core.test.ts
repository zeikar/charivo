import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CharivoTransportError,
  type Character,
  type CharivoEventEmitter,
  type RealtimeState,
  type RealtimeToolRegistration,
} from "@charivo/core";
import {
  createRealtimeManager,
  type RealtimeLogger,
  type RealtimeTransportClient,
  type RealtimeTransportEvent,
} from "@charivo/realtime";
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import {
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/realtime-avatar";

function createRealtimeClientStub(options?: {
  emitSessionStartedOnConnect?: boolean;
  emitSessionEndedOnDisconnect?: boolean;
}) {
  const eventHandlers = new Set<
    (event: RealtimeTransportEvent) => void | Promise<void>
  >();

  const emitEvent = async (event: RealtimeTransportEvent) => {
    for (const handler of eventHandlers) {
      await handler(event);
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const client: RealtimeTransportClient = {
    connect: vi.fn(async () => {
      if (options?.emitSessionStartedOnConnect) {
        await emitEvent({ type: "session.started" });
      }
    }),
    updateSession: vi.fn(async () => undefined),
    recover: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => {
      if (options?.emitSessionEndedOnDisconnect) {
        await emitEvent({ type: "session.ended" });
      }
    }),
    sendText: vi.fn(async () => undefined),
    sendAudio: vi.fn(async () => undefined),
    sendToolResult: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    onEvent: vi.fn((callback) => {
      eventHandlers.add(callback);
    }),
  };

  return {
    client,
    emit: emitEvent,
  };
}

function createEventEmitter(): CharivoEventEmitter {
  return {
    emit: vi.fn(),
  };
}

function getEventPayloads(
  eventEmitter: CharivoEventEmitter,
  eventName: string,
): unknown[] {
  return (eventEmitter.emit as ReturnType<typeof vi.fn>).mock.calls
    .filter(([name]) => name === eventName)
    .map(([, payload]) => payload);
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("realtime-core", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("builds character-aware session config without auto-injecting tools", () => {
    const character: Character = {
      id: "char-1",
      name: "Hiyori",
      description: "A thoughtful and gentle character with a calm demeanor",
      personality: "Cheerful and helpful assistant",
      voice: {
        voiceId: "alloy",
      },
    };

    const config = buildRealtimeSessionConfig({
      character,
    });

    expect(config.provider).toBe("openai");
    expect(config.transport).toBe("webrtc");
    expect(config.model).toBe("gpt-realtime-mini");
    expect(config.voice).toBe("alloy");
    expect(config.instructions).toMatch(/^You are Hiyori\./);
    expect(config.instructions).toContain(
      "Stay fully in character during the conversation.",
    );
    expect(config.instructions).toContain(
      "A thoughtful and gentle character with a calm demeanor.",
    );
    expect(config.instructions).toContain(
      "Never break character. Never refer to yourself as an AI, model, or assistant.",
    );
    expect(config.instructions).toContain(
      "You are speaking in a realtime voice conversation.",
    );
    expect(config.instructions).toContain(
      "Respond naturally and keep replies concise enough for spoken delivery.",
    );
    expect(config.instructions).toContain(
      "Use tools only when they add something meaningful to the moment.",
    );
    expect(config.instructions).toContain(
      "Never say tool names or tool arguments out loud.",
    );
    expect(config.tools).toBeUndefined();
  });

  it("builds catalog-based avatar control tools", async () => {
    const tools = createAvatarControlTools({
      expressions: ["Smile"],
      motions: {
        Idle: 2,
      },
    });
    const [expressionTool, motionTool, gazeTool] = tools;

    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "setExpression",
      "playMotion",
      "lookAt",
    ]);
    expect(
      expressionTool!.definition.parameters.properties.expressionId,
    ).toMatchObject({
      enum: ["Smile"],
    });
    expect(expressionTool!.definition.description).toContain(
      "Do not use this for every polite or lightweight reaction.",
    );
    expect(motionTool!.definition.parameters.properties.group).toMatchObject({
      enum: ["Idle"],
    });
    expect(motionTool!.definition.description).toContain(
      "Usually use at most one motion in a reply.",
    );
    expect(gazeTool!.definition.description).toContain(
      'Prefer this before "setExpression" when a lightweight reaction is enough.',
    );

    await expect(
      expressionTool!.handler(
        { expressionId: "Missing" },
        {
          character: null,
          state: {
            connection: "idle",
            session: { status: "idle", config: null },
            response: { status: "idle", text: "" },
            lastError: null,
          },
        },
      ),
    ).rejects.toThrow('setExpression requires a valid "expressionId"');

    await expect(
      gazeTool!.handler(
        { x: 4, y: -4 },
        {
          character: null,
          state: {
            connection: "idle",
            session: { status: "idle", config: null },
            response: { status: "idle", text: "" },
            lastError: null,
          },
        },
      ),
    ).resolves.toMatchObject({ x: 1, y: -1 });
  });

  it("starts with registry tools and executes built-in and custom handlers", async () => {
    const stub = createRealtimeClientStub();
    const avatarTools = createAvatarControlTools({
      expressions: ["exp_happy"],
      motions: {
        TapBody: 2,
      },
    });
    const describeSceneTool: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "describeScene",
        description: "Describe the current scene context.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(async (_args, context) => ({
        success: true,
        characterId: context.character?.id ?? null,
        responseStatus: context.state.response.status,
      })),
    };
    const manager = createRealtimeManager(stub.client, {
      tools: [...avatarTools, describeSceneTool],
      resultProjectors: [createAvatarResultProjector()],
    });
    const eventEmitter: CharivoEventEmitter = {
      emit: vi.fn(),
    };

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter({
      id: "char-1",
      name: "Hiyori",
    });

    await manager.startSession({
      provider: "openai",
      model: "gpt-realtime-mini",
      voice: "marin",
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:session:start", {
      state: expect.objectContaining({
        session: expect.objectContaining({
          status: "active",
        }),
      }),
      reason: "user",
    });

    expect(manager.getRegisteredTools().map((tool) => tool.name)).toEqual([
      "setExpression",
      "playMotion",
      "lookAt",
      "describeScene",
    ]);
    expect(stub.client.connect).toHaveBeenCalledWith({
      provider: "openai",
      transport: "webrtc",
      model: "gpt-realtime-mini",
      voice: "marin",
      instructions: expect.any(String),
      tools: [
        avatarTools[0]!.definition,
        avatarTools[1]!.definition,
        avatarTools[2]!.definition,
        describeSceneTool.definition,
      ],
      toolChoice: "auto",
    });

    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "exp_happy" },
      callId: "call-1",
    });
    await stub.emit({
      type: "tool.call",
      name: "describeScene",
      args: {},
      callId: "call-2",
    });

    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(1, "call-1", {
      success: true,
      expressionId: "exp_happy",
    });
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(2, "call-2", {
      success: true,
      characterId: "char-1",
      responseStatus: "idle",
    });
    expect(describeSceneTool.handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        character: expect.objectContaining({ id: "char-1" }),
        state: expect.objectContaining({
          session: expect.objectContaining({ status: "active" }),
        }),
        callId: "call-2",
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:expression", {
      expressionId: "exp_happy",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:call", {
      name: "setExpression",
      args: { expressionId: "exp_happy" },
      callId: "call-1",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:result", {
      name: "describeScene",
      output: {
        success: true,
        characterId: "char-1",
        responseStatus: "idle",
      },
      callId: "call-2",
    });
  });

  it("emits canonical avatar action events for direct tools", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client, {
      tools: createAvatarControlTools({
        expressions: ["Smile"],
        motions: {
          Idle: 1,
        },
      }),
      resultProjectors: [createAvatarResultProjector()],
    });
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Smile" },
      callId: "call-expression",
    });
    await stub.emit({
      type: "tool.call",
      name: "playMotion",
      args: { group: "Idle", index: 0 },
      callId: "call-motion",
    });
    await stub.emit({
      type: "tool.call",
      name: "lookAt",
      args: { x: 0.4, y: -0.2 },
      callId: "call-gaze",
    });

    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:expression", {
      expressionId: "Smile",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:motion", {
      group: "Idle",
      index: 0,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:gaze", {
      x: 0.4,
      y: -0.2,
    });

    const toolResultIndex = (
      eventEmitter.emit as ReturnType<typeof vi.fn>
    ).mock.calls.findIndex(
      ([name, payload]) =>
        name === "realtime:tool:result" &&
        (payload as { callId?: string }).callId === "call-expression",
    );
    const projectedExpressionIndex = (
      eventEmitter.emit as ReturnType<typeof vi.fn>
    ).mock.calls.findIndex(([name]) => name === "realtime:expression");

    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(projectedExpressionIndex).toBeGreaterThan(toolResultIndex);
  });

  it("does not emit avatar events without a result projector", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client, {
      tools: createAvatarControlTools({
        expressions: ["Smile"],
        motions: {
          Idle: 1,
        },
      }),
    });
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Smile" },
      callId: "call-expression",
    });

    expect(getEventPayloads(eventEmitter, "realtime:expression")).toEqual([]);
    expect(getEventPayloads(eventEmitter, "realtime:tool:result")).toEqual([
      {
        name: "setExpression",
        output: {
          success: true,
          expressionId: "Smile",
        },
        callId: "call-expression",
      },
    ]);
  });

  it("isolates projector failures after tool results are sent", async () => {
    const stub = createRealtimeClientStub();
    const logger: RealtimeLogger = {
      warn: vi.fn(),
    };
    const manager = createRealtimeManager(stub.client, {
      tools: createAvatarControlTools({
        expressions: ["Smile"],
        motions: {
          Idle: 1,
        },
      }),
      resultProjectors: [
        () => {
          throw new Error("projector boom");
        },
      ],
      logger,
    });
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Smile" },
      callId: "call-projector",
    });

    expect(stub.client.sendToolResult).toHaveBeenCalledTimes(1);
    expect(getEventPayloads(eventEmitter, "realtime:tool:error")).toEqual([]);
    expect(getEventPayloads(eventEmitter, "realtime:tool:result")).toEqual([
      {
        name: "setExpression",
        output: {
          success: true,
          expressionId: "Smile",
        },
        callId: "call-projector",
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Realtime result projector failed",
      expect.objectContaining({
        name: "setExpression",
        callId: "call-projector",
        error: "projector boom",
      }),
    );
  });

  it("normalizes tool failures and relays transport events", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client, {
      tools: createAvatarControlTools({
        expressions: ["Smile"],
        motions: {
          Idle: 1,
        },
      }),
    });
    const eventEmitter: CharivoEventEmitter = {
      emit: vi.fn(),
    };

    manager.setEventEmitter(eventEmitter);
    manager.setCharacter({
      id: "char-1",
      name: "Hiyori",
    });

    await manager.startSession({
      provider: "openai",
    });

    await manager.sendMessage("hello");
    await manager.interrupt();
    expect(manager.getState().response.status).toBe("interrupted");

    await stub.emit({ type: "assistant.response.completed", text: "" });
    expect(manager.getState().response.status).toBe("interrupted");

    await stub.emit({ type: "assistant.response.started" });
    await stub.emit({ type: "assistant.text.delta", text: "hel" });
    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Missing" },
      callId: "call-invalid",
    });
    await stub.emit({
      type: "tool.call",
      name: "missingTool",
      args: {},
      callId: "call-missing",
    });
    await stub.emit({
      type: "tool.result",
      name: "serverTool",
      output: { success: true },
      callId: "call-server",
    });
    await stub.emit({ type: "audio.lipsync", rms: 0.4 });
    await stub.emit({ type: "audio.output.ended" });
    await stub.emit({ type: "user.transcript", text: "hello there" });
    await stub.emit({ type: "assistant.response.completed", text: "hello" });
    await stub.emit({ type: "error", error: new Error("boom") });

    expect(stub.client.sendText).toHaveBeenCalledWith("hello");
    expect(stub.client.interrupt).toHaveBeenCalledTimes(1);
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(
      1,
      "call-invalid",
      {
        success: false,
        error:
          'setExpression requires a valid "expressionId" from the model catalog',
      },
    );
    expect(stub.client.sendToolResult).toHaveBeenNthCalledWith(
      2,
      "call-missing",
      {
        success: false,
        error: 'No realtime tool registered for "missingTool"',
      },
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:assistant:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:text:delta", {
      text: "hel",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:result", {
      name: "serverTool",
      output: { success: true },
      callId: "call-server",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:error", {
      name: "setExpression",
      error: expect.any(Error),
      callId: "call-invalid",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:tool:error", {
      name: "missingTool",
      error: expect.any(Error),
      callId: "call-missing",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("tts:lipsync:update", {
      rms: 0.4,
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:user:transcript", {
      text: "hello there",
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith("realtime:error", {
      error: expect.any(Error),
    });
    expect(manager.getState().response.text).toBe("hello");
    expect(manager.getState().lastError?.message).toBe("boom");
  });

  it("emits realtime usage events when transport usage is available", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
      type: "assistant.response.completed",
      text: "hello",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
      model: "gpt-realtime",
      responseId: "resp_123",
    });

    expect(getEventPayloads(eventEmitter, "realtime:usage")).toEqual([
      {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
        model: "gpt-realtime",
        responseId: "resp_123",
      },
    ]);
  });

  it("logs session, tool, reconnect, and error boundaries when a logger is configured", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub({
      emitSessionEndedOnDisconnect: true,
    });
    const logger: RealtimeLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const manager = createRealtimeManager(stub.client, {
      tools: createAvatarControlTools({
        expressions: ["Smile"],
        motions: {
          Idle: 1,
        },
      }),
      resultProjectors: [createAvatarResultProjector()],
      logger,
    });

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Smile" },
      callId: "call-log-ok",
    });
    await stub.emit({
      type: "tool.call",
      name: "setExpression",
      args: { expressionId: "Missing" },
      callId: "call-log-fail",
    });
    await stub.emit({
      type: "connection.lost",
      cause: "offline",
      error: new Error("network"),
    });
    await vi.runAllTimersAsync();
    await stub.emit({
      type: "error",
      error: new Error("transport boom"),
    });
    await manager.stopSession();

    expect(logger.info).toHaveBeenCalledWith(
      "Realtime session started",
      expect.objectContaining({ reason: "user" }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      "Realtime tool execution started",
      expect.objectContaining({ name: "setExpression", callId: "call-log-ok" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime tool execution succeeded",
      expect.objectContaining({ name: "setExpression", callId: "call-log-ok" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Realtime tool execution failed",
      expect.objectContaining({
        name: "setExpression",
        callId: "call-log-fail",
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime reconnect attempt",
      expect.objectContaining({ attempt: 1, cause: "offline" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime reconnect succeeded",
      expect.objectContaining({ attempts: 1, cause: "offline" }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Realtime transport error surfaced",
      expect.objectContaining({ error: "transport boom" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Realtime session ended",
      expect.objectContaining({ reason: "user" }),
    );
  });

  it("times out slow tools and supports unregistering before the next session", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const slowTool: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "slowTool",
        description: "Never resolves in time.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(
        async () => await new Promise<Record<string, unknown>>(() => undefined),
      ),
      timeoutMs: 50,
    };
    const manager = createRealtimeManager(stub.client, {
      tools: [slowTool],
    });

    await manager.startSession({
      provider: "openai",
    });

    const toolCall = stub.emit({
      type: "tool.call",
      name: "slowTool",
      args: {},
      callId: "call-timeout",
    });

    await vi.advanceTimersByTimeAsync(50);
    await toolCall;

    expect(stub.client.sendToolResult).toHaveBeenCalledWith("call-timeout", {
      success: false,
      error: 'Realtime tool "slowTool" timed out after 50ms',
    });

    await manager.stopSession();
    expect(manager.getRegisteredTools().map((tool) => tool.name)).toEqual([
      "slowTool",
    ]);
  });

  it("merges state updates emitted by the transport client", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
    });

    await stub.emit({
      type: "state",
      state: {
        response: {
          status: "responding",
          text: "partial",
        },
      } as Partial<RealtimeState>,
    });

    expect(manager.getState().response).toEqual({
      status: "responding",
      text: "partial",
    });
  });

  it("caches inactive session updates for the next start", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    await manager.updateSession({
      provider: "openai",
      voice: "marin",
    });

    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(stub.client.updateSession).not.toHaveBeenCalled();
    expect(stub.client.disconnect).not.toHaveBeenCalled();

    await manager.startSession();

    expect(stub.client.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        voice: "marin",
      }),
    );
  });

  it("refreshes active sessions without emitting a stopped intermediate state", async () => {
    const stub = createRealtimeClientStub({
      emitSessionStartedOnConnect: true,
    });
    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    (eventEmitter.emit as ReturnType<typeof vi.fn>).mockClear();
    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();

    await manager.updateSession({
      voice: "alloy",
    });

    expect(stub.client.disconnect).not.toHaveBeenCalled();
    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(stub.client.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );

    const statePayloads = getEventPayloads(
      eventEmitter,
      "realtime:state",
    ) as Array<{ state: RealtimeState }>;
    expect(statePayloads.map(({ state }) => state.connection)).toEqual([
      "connected",
      "connected",
    ]);
    expect(
      statePayloads.every(({ state }) => state.session.status !== "stopped"),
    ).toBe(true);
    expect(statePayloads[0]?.state.session.config?.voice).toBe("marin");
    expect(statePayloads[1]?.state.session.config?.voice).toBe("alloy");

    const sessionBoundaryCalls = (
      eventEmitter.emit as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      ([name]) =>
        name === "realtime:session:end" || name === "realtime:session:start",
    );
    expect(sessionBoundaryCalls).toHaveLength(0);
  });

  it("keeps setCharacter side-effect free until updateSession is called", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    manager.setCharacter({
      id: "char-1",
      name: "Hiyori",
      voice: {
        voiceId: "marin",
      },
    });

    await manager.startSession({
      provider: "openai",
    });

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();

    manager.setCharacter({
      id: "char-2",
      name: "Mika",
      personality: "Calm and observant",
      voice: {
        voiceId: "alloy",
      },
    });

    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(stub.client.updateSession).not.toHaveBeenCalled();
    expect(stub.client.disconnect).not.toHaveBeenCalled();

    await manager.updateSession();

    expect(stub.client.disconnect).not.toHaveBeenCalled();
    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(stub.client.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        voice: "alloy",
        instructions: expect.stringContaining("Mika"),
      }),
    );
  });

  it("applies tool registry mutations on the next session refresh", async () => {
    const stub = createRealtimeClientStub();
    const toolA: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "toolA",
        description: "Tool A",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(async () => ({ success: true })),
    };
    const toolB: RealtimeToolRegistration = {
      definition: {
        type: "function",
        name: "toolB",
        description: "Tool B",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      handler: vi.fn(async () => ({ success: true })),
    };
    const manager = createRealtimeManager(stub.client, {
      tools: [toolA],
    });

    await manager.startSession({
      provider: "openai",
    });

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();

    manager.registerTool(toolB);
    await manager.updateSession();

    expect(stub.client.updateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "toolA" }),
          expect.objectContaining({ name: "toolB" }),
        ]),
      }),
    );

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();

    manager.unregisterTool("toolA");
    await manager.updateSession();

    const refreshedConfig = vi.mocked(stub.client.updateSession).mock
      .calls[0]?.[0];
    expect(refreshedConfig).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "toolB" }),
      ]),
    });
    expect(
      (refreshedConfig?.tools ?? []).some((tool) => tool.name === "toolA"),
    ).toBe(false);
  });

  it("keeps the active session on refresh failures and can retry patching", async () => {
    const stub = createRealtimeClientStub();
    let updateAttempts = 0;

    vi.mocked(stub.client.updateSession).mockImplementation(async () => {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        throw new Error("refresh failed");
      }
    });

    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    await expect(
      manager.updateSession({
        voice: "alloy",
      }),
    ).rejects.toThrow("refresh failed");

    expect(manager.getState()).toMatchObject({
      connection: "connected",
      session: {
        status: "active",
        config: expect.objectContaining({
          voice: "marin",
        }),
      },
      lastError: expect.objectContaining({
        message: "refresh failed",
      }),
    });

    await manager.updateSession({
      voice: "alloy",
    });

    expect(stub.client.updateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );
    expect(manager.getState().session.config?.voice).toBe("alloy");
  });

  it("emits a single realtime:error when a session patch failure also arrives as a transport error event", async () => {
    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    const refreshError = new Error("session patch rejected");
    vi.mocked(stub.client.updateSession).mockImplementationOnce(async () => {
      await stub.emit({
        type: "error",
        error: refreshError,
      });
      throw refreshError;
    });

    await expect(
      manager.updateSession({
        voice: "alloy",
      }),
    ).rejects.toBeInstanceOf(CharivoTransportError);

    const realtimeErrors = getEventPayloads(eventEmitter, "realtime:error");
    expect(realtimeErrors).toHaveLength(1);
    expect(realtimeErrors[0]?.error).toBeInstanceOf(CharivoTransportError);
    expect(realtimeErrors[0]?.error).toMatchObject({
      message: "session patch rejected",
      cause: refreshError,
    });
  });

  it("coalesces repeated session refresh requests to the latest config", async () => {
    const stub = createRealtimeClientStub();
    const firstUpdate = createDeferred<void>();
    let updateCount = 0;

    vi.mocked(stub.client.updateSession).mockImplementation(async () => {
      updateCount += 1;
      if (updateCount === 1) {
        await firstUpdate.promise;
      }
    });

    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();
    updateCount = 0;

    const firstRefresh = manager.updateSession({
      voice: "alloy",
    });
    const secondRefresh = manager.updateSession({
      voice: "nova",
    });

    expect(firstRefresh).toBe(secondRefresh);

    firstUpdate.resolve(undefined);
    await firstRefresh;

    expect(stub.client.disconnect).not.toHaveBeenCalled();
    expect(vi.mocked(stub.client.updateSession).mock.calls).toHaveLength(2);
    expect(
      vi.mocked(stub.client.updateSession).mock.calls[0]?.[0],
    ).toMatchObject({
      voice: "alloy",
    });
    expect(
      vi.mocked(stub.client.updateSession).mock.calls[1]?.[0],
    ).toMatchObject({
      voice: "nova",
    });
    expect(manager.getState().session.config?.voice).toBe("nova");
  });

  it("cancels refresh and converges to stopped when stopSession wins", async () => {
    const stub = createRealtimeClientStub();
    const updateGate = createDeferred<void>();
    let updateCount = 0;

    vi.mocked(stub.client.updateSession).mockImplementation(async () => {
      updateCount += 1;
      if (updateCount === 1) {
        await updateGate.promise;
      }
    });

    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();
    manager.setEventEmitter(eventEmitter);

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.updateSession).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();
    (eventEmitter.emit as ReturnType<typeof vi.fn>).mockClear();
    updateCount = 0;

    const refreshPromise = manager.updateSession({
      voice: "alloy",
    });
    const stopPromise = manager.stopSession();

    updateGate.resolve(undefined);
    await Promise.all([refreshPromise, stopPromise]);

    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(stub.client.updateSession).toHaveBeenCalledTimes(1);
    expect(stub.client.disconnect).toHaveBeenCalledTimes(1);
    expect(manager.getState().session.status).toBe("stopped");
    expect(manager.getState().connection).toBe("idle");
    const statePayloads = getEventPayloads(
      eventEmitter,
      "realtime:state",
    ) as Array<{ state: RealtimeState }>;
    expect(
      statePayloads.some(
        ({ state }) =>
          state.session.status === "active" &&
          state.session.config?.voice === "alloy",
      ),
    ).toBe(false);
    expect(
      getEventPayloads(eventEmitter, "realtime:session:end"),
    ).toContainEqual(
      expect.objectContaining({
        reason: "user",
      }),
    );
  });

  it("reconnects active sessions without emitting synthetic session boundaries", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();
    const recoverGate = createDeferred<void>();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.recover).mockImplementation(async () => {
      await recoverGate.promise;
    });
    (eventEmitter.emit as ReturnType<typeof vi.fn>).mockClear();

    await stub.emit({
      type: "connection.lost",
      cause: "offline",
    });

    expect(manager.getState()).toMatchObject({
      connection: "connecting",
      session: {
        status: "active",
        config: expect.objectContaining({
          voice: "marin",
        }),
      },
    });
    await expect(manager.sendMessage("hello")).rejects.toThrow(
      "Realtime session is reconnecting",
    );

    await vi.advanceTimersByTimeAsync(500);
    recoverGate.resolve(undefined);
    await vi.runAllTimersAsync();

    expect(stub.client.recover).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "marin",
      }),
    );
    expect(manager.getState()).toMatchObject({
      connection: "connected",
      session: {
        status: "active",
        config: expect.objectContaining({
          voice: "marin",
        }),
      },
    });
    expect(getEventPayloads(eventEmitter, "realtime:session:start")).toEqual(
      [],
    );
    expect(getEventPayloads(eventEmitter, "realtime:session:end")).toEqual([]);
    expect(
      getEventPayloads(eventEmitter, "realtime:reconnect:attempt"),
    ).toEqual([
      {
        attempt: 1,
        delayMs: 500,
        cause: "offline",
      },
    ]);
    expect(
      getEventPayloads(eventEmitter, "realtime:reconnect:success"),
    ).toEqual([
      expect.objectContaining({
        attempts: 1,
        cause: "offline",
      }),
    ]);
  });

  it("uses the latest cached session config for the next reconnect attempt", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const recoverCalls: Array<string | undefined> = [];

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.recover).mockImplementation(async (config) => {
      recoverCalls.push(config?.voice);
      if (recoverCalls.length === 1) {
        throw new Error("still offline");
      }
    });

    await stub.emit({
      type: "connection.lost",
      cause: "offline",
    });

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    await manager.updateSession({
      voice: "alloy",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(recoverCalls).toEqual(["marin", "alloy"]);
    expect(manager.getState().session.config?.voice).toBe("alloy");
  });

  it("waits for an in-flight reconnect before stopping and stays stopped after recover resolves", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const recoverGate = createDeferred<void>();

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.recover).mockImplementation(async () => {
      await recoverGate.promise;
    });

    await stub.emit({
      type: "connection.lost",
      cause: "offline",
    });

    await vi.advanceTimersByTimeAsync(500);
    const stopPromise = manager.stopSession();

    expect(stub.client.disconnect).not.toHaveBeenCalled();

    recoverGate.resolve(undefined);
    await stopPromise;

    expect(stub.client.disconnect).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      connection: "idle",
      session: {
        status: "stopped",
        config: null,
      },
    });
  });

  it("emits reconnect exhausted and finalizes the session after five failed recover attempts", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);
    const eventEmitter = createEventEmitter();

    manager.setEventEmitter(eventEmitter);
    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.recover).mockImplementation(async () => {
      throw new Error("recover failed");
    });
    (eventEmitter.emit as ReturnType<typeof vi.fn>).mockClear();

    await stub.emit({
      type: "connection.lost",
      cause: "offline",
    });

    await vi.runAllTimersAsync();

    expect(stub.client.recover).toHaveBeenCalledTimes(5);
    expect(
      getEventPayloads(eventEmitter, "realtime:reconnect:exhausted"),
    ).toEqual([
      expect.objectContaining({
        attempts: 5,
        cause: "offline",
        lastError: expect.objectContaining({
          message: "recover failed",
        }),
      }),
    ]);
    expect(manager.getState()).toMatchObject({
      connection: "error",
      session: {
        status: "stopped",
      },
      lastError: expect.objectContaining({
        message: "recover failed",
      }),
    });
  });

  it("keeps interrupted response state through reconnect and resets on the next fresh turn", async () => {
    vi.useFakeTimers();

    const stub = createRealtimeClientStub();
    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    await stub.emit({
      type: "assistant.response.started",
    });
    await stub.emit({
      type: "assistant.text.delta",
      text: "partial",
    });

    vi.mocked(stub.client.recover).mockResolvedValue(undefined);
    await stub.emit({
      type: "connection.lost",
      cause: "offline",
    });

    expect(manager.getState().response).toEqual({
      status: "interrupted",
      text: "partial",
    });

    await vi.runAllTimersAsync();

    expect(manager.getState().response).toEqual({
      status: "interrupted",
      text: "partial",
    });

    await stub.emit({
      type: "assistant.response.started",
    });
    await stub.emit({
      type: "assistant.text.delta",
      text: "fresh",
    });
    await stub.emit({
      type: "assistant.response.completed",
      text: "fresh",
    });

    expect(manager.getState().response).toEqual({
      status: "completed",
      text: "fresh",
    });
  });
});
