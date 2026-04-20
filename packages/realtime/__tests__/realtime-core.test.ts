import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Character,
  type CharivoEventEmitter,
  type RealtimeState,
  type RealtimeToolRegistration,
} from "@charivo/core";
import {
  buildRealtimeSessionConfig,
  createAvatarControlTools,
  createRealtimeManager,
  type RealtimeTransportClient,
  type RealtimeTransportEvent,
} from "@charivo/realtime";

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
      "Never break character. Never refer to yourself as an AI, model, or assistant.",
    );
    expect(config.instructions).toContain(
      'Use "setExpression" only when the emotional beat clearly shifts',
    );
    expect(config.instructions).toContain(
      "Many turns should use no avatar tool at all.",
    );
    expect(config.instructions).toContain(
      "Do not wrap actions or emotions in brackets, asterisks, or parentheticals",
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
      "Usually keep the same expression for a few turns.",
    );
    expect(motionTool!.definition.parameters.properties.group).toMatchObject({
      enum: ["Idle"],
    });
    expect(motionTool!.definition.description).toContain(
      "Usually use at most one motion in a reply.",
    );
    expect(gazeTool!.definition.description).toContain(
      "Prefer this when a lightweight reaction is enough.",
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
    vi.mocked(stub.client.disconnect).mockClear();

    await manager.updateSession({
      voice: "alloy",
    });

    expect(stub.client.disconnect).toHaveBeenCalledTimes(1);
    expect(stub.client.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );

    const statePayloads = getEventPayloads(
      eventEmitter,
      "realtime:state",
    ) as Array<{ state: RealtimeState }>;
    expect(statePayloads.map(({ state }) => state.connection)).toEqual([
      "disconnecting",
      "connecting",
      "connected",
    ]);
    expect(
      statePayloads.every(({ state }) => state.session.status !== "stopped"),
    ).toBe(true);
    expect(statePayloads[0]?.state.session.config?.voice).toBe("marin");
    expect(statePayloads[1]?.state.session.config?.voice).toBe("marin");
    expect(statePayloads[2]?.state.session.config?.voice).toBe("alloy");

    const sessionBoundaryCalls = (
      eventEmitter.emit as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      ([name]) =>
        name === "realtime:session:end" || name === "realtime:session:start",
    );
    expect(sessionBoundaryCalls.map(([name]) => name)).toEqual([
      "realtime:session:end",
      "realtime:session:start",
    ]);
    expect(sessionBoundaryCalls[0]?.[1]).toMatchObject({
      reason: "refresh",
      state: {
        session: {
          config: expect.objectContaining({
            voice: "marin",
          }),
        },
      },
    });
    expect(sessionBoundaryCalls[1]?.[1]).toMatchObject({
      reason: "refresh",
      state: {
        session: {
          config: expect.objectContaining({
            voice: "alloy",
          }),
        },
      },
    });
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
    expect(stub.client.disconnect).not.toHaveBeenCalled();

    await manager.updateSession();

    expect(stub.client.disconnect).toHaveBeenCalledTimes(1);
    expect(stub.client.connect).toHaveBeenCalledWith(
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
    vi.mocked(stub.client.disconnect).mockClear();

    manager.registerTool(toolB);
    await manager.updateSession();

    expect(stub.client.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "toolA" }),
          expect.objectContaining({ name: "toolB" }),
        ]),
      }),
    );

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();

    manager.unregisterTool("toolA");
    await manager.updateSession();

    const refreshedConfig = vi.mocked(stub.client.connect).mock.calls[0]?.[0];
    expect(refreshedConfig).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "toolB" }),
      ]),
    });
    expect(
      (refreshedConfig?.tools ?? []).some((tool) => tool.name === "toolA"),
    ).toBe(false);
  });

  it("stops cleanly on refresh failures and can be started again", async () => {
    const stub = createRealtimeClientStub();
    let connectAttempts = 0;

    vi.mocked(stub.client.connect).mockImplementation(async () => {
      connectAttempts += 1;
      if (connectAttempts === 2) {
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
      connection: "error",
      session: {
        status: "stopped",
        config: null,
      },
      lastError: expect.objectContaining({
        message: "refresh failed",
      }),
    });

    vi.mocked(stub.client.connect).mockImplementation(async () => undefined);

    await manager.startSession();

    expect(stub.client.connect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        voice: "alloy",
      }),
    );
  });

  it("coalesces repeated session refresh requests to the latest config", async () => {
    const stub = createRealtimeClientStub();
    const firstDisconnect = createDeferred<void>();
    let disconnectCount = 0;

    vi.mocked(stub.client.disconnect).mockImplementation(async () => {
      disconnectCount += 1;
      if (disconnectCount === 1) {
        await firstDisconnect.promise;
      }
    });

    const manager = createRealtimeManager(stub.client);

    await manager.startSession({
      provider: "openai",
      voice: "marin",
    });

    vi.mocked(stub.client.connect).mockClear();
    vi.mocked(stub.client.disconnect).mockClear();
    disconnectCount = 0;

    const firstRefresh = manager.updateSession({
      voice: "alloy",
    });
    const secondRefresh = manager.updateSession({
      voice: "nova",
    });

    expect(firstRefresh).toBe(secondRefresh);

    firstDisconnect.resolve(undefined);
    await firstRefresh;

    expect(stub.client.disconnect).toHaveBeenCalledTimes(2);
    expect(vi.mocked(stub.client.connect).mock.calls).toHaveLength(2);
    expect(vi.mocked(stub.client.connect).mock.calls[0]?.[0]).toMatchObject({
      voice: "alloy",
    });
    expect(vi.mocked(stub.client.connect).mock.calls[1]?.[0]).toMatchObject({
      voice: "nova",
    });
    expect(manager.getState().session.config?.voice).toBe("nova");
  });

  it("cancels refresh and converges to stopped when stopSession wins", async () => {
    const stub = createRealtimeClientStub();
    const disconnectGate = createDeferred<void>();
    let disconnectCount = 0;

    vi.mocked(stub.client.disconnect).mockImplementation(async () => {
      disconnectCount += 1;
      if (disconnectCount === 1) {
        await disconnectGate.promise;
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
    vi.mocked(stub.client.disconnect).mockClear();
    (eventEmitter.emit as ReturnType<typeof vi.fn>).mockClear();
    disconnectCount = 0;

    const refreshPromise = manager.updateSession({
      voice: "alloy",
    });
    const stopPromise = manager.stopSession();

    disconnectGate.resolve(undefined);
    await Promise.all([refreshPromise, stopPromise]);

    expect(stub.client.connect).not.toHaveBeenCalled();
    expect(manager.getState().session.status).toBe("stopped");
    expect(manager.getState().connection).toBe("idle");
    expect(
      getEventPayloads(eventEmitter, "realtime:session:end"),
    ).toContainEqual(
      expect.objectContaining({
        reason: "user",
      }),
    );
  });
});
