import { describe, expect, it } from "vitest";
import {
  Charivo,
  OPENAI_REALTIME_AGENTS_ADAPTER,
  type AvatarControlCatalog,
  type Character,
  type EventMap,
  type RealtimeSessionBootstrap,
  type RealtimeSessionConfig,
  type RealtimeSessionRequest,
  type RealtimeTool,
} from "@charivo/core";
import { isRealtimeSessionBootstrap } from "@charivo/shared";
import {
  LOOK_AT_TOOL_NAME,
  PLAY_MOTION_TOOL_NAME,
  SET_EXPRESSION_TOOL_NAME,
  createAvatarControlTools,
  createRealtimeManager,
  type RealtimeTransportClient,
  type RealtimeTransportEvent,
} from "@charivo/realtime-core";
import { POST } from "../../examples/web/src/app/api/realtime/route";

const RUN_LIVE_REALTIME_TESTS = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_OPENAI_API_KEY = Boolean(process.env.OPENAI_API_KEY);

const liveDescribe =
  RUN_LIVE_REALTIME_TESTS && HAS_OPENAI_API_KEY ? describe : describe.skip;

const SMOKE_CHARACTER: Character = {
  id: "smoke-hiyori",
  name: "Hiyori",
  personality: "Calm, attentive, and expressive in small moments.",
};

const SMOKE_CATALOG: AvatarControlCatalog = {
  expressions: ["Smile"],
  motions: {
    Wave: 1,
  },
};

class LiveBootstrapSmokeClient implements RealtimeTransportClient {
  private readonly callbacks = new Set<
    (event: RealtimeTransportEvent) => void
  >();
  private latestConfig: RealtimeSessionConfig | undefined;
  private latestBootstrap: RealtimeSessionBootstrap | null = null;
  private latestToolCall: Extract<
    RealtimeTransportEvent,
    { type: "tool.call" }
  > | null = null;
  private nextCallId = 1;
  readonly observedEvents: string[] = [];

  get bootstrap(): RealtimeSessionBootstrap | null {
    return this.latestBootstrap;
  }

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    this.latestConfig = config;
    this.latestBootstrap = await requestLiveBootstrap(config);
    this.emit({ type: "session.started" });
  }

  async disconnect(): Promise<void> {
    this.emit({ type: "session.ended" });
  }

  async sendText(text: string): Promise<void> {
    this.emit({ type: "assistant.response.started" });

    const toolCall = this.createToolCall(text);
    if (!toolCall) {
      this.emit({
        type: "assistant.response.completed",
        text: "Live smoke acknowledged.",
      });
      return;
    }

    this.latestToolCall = toolCall;
    this.emit(toolCall);
  }

  async sendAudio(_audio: ArrayBuffer): Promise<void> {
    throw new Error("Audio is out of scope for the live smoke test");
  }

  async sendToolResult(
    callId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    const name = this.latestToolCall?.name ?? "unknown";

    this.emit({
      type: "tool.result",
      name,
      output,
      callId,
    });
    this.emit({
      type: "assistant.response.completed",
      text: "Avatar action executed.",
    });
  }

  async interrupt(): Promise<void> {
    this.emit({ type: "session.ended" });
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.callbacks.add(callback);
  }

  private emit(event: RealtimeTransportEvent): void {
    const eventLabel =
      event.type === "tool.call" || event.type === "tool.result"
        ? `${event.type}:${event.name}`
        : event.type;
    this.observedEvents.push(eventLabel);

    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  private createToolCall(
    text: string,
  ): Extract<RealtimeTransportEvent, { type: "tool.call" }> | null {
    const tools = this.latestConfig?.tools ?? [];
    const callId = `live-smoke-call-${this.nextCallId++}`;
    const lowerText = text.toLowerCase();

    if (lowerText.includes("smile")) {
      const expressionId = readFirstExpressionId(tools);
      if (expressionId) {
        return {
          type: "tool.call",
          name: SET_EXPRESSION_TOOL_NAME,
          args: { expressionId },
          callId,
        };
      }
    }

    if (lowerText.includes("wave")) {
      const motion = readFirstMotion(tools);
      if (motion) {
        return {
          type: "tool.call",
          name: PLAY_MOTION_TOOL_NAME,
          args: motion,
          callId,
        };
      }
    }

    if (hasTool(tools, LOOK_AT_TOOL_NAME)) {
      return {
        type: "tool.call",
        name: LOOK_AT_TOOL_NAME,
        args: { x: 0.4, y: 0 },
        callId,
      };
    }

    return null;
  }
}

liveDescribe("live realtime bootstrap and local manager plumbing", () => {
  it("creates a live bootstrap and relays a local canonical avatar event", async () => {
    const client = new LiveBootstrapSmokeClient();
    const realtimeManager = createRealtimeManager(client, {
      tools: createAvatarControlTools(SMOKE_CATALOG),
    });
    const charivo = new Charivo();
    charivo.attachRealtime(realtimeManager);
    charivo.setCharacter(SMOKE_CHARACTER);

    const sessionStartPromise = waitForEvent(
      charivo,
      "realtime:session:start",
      client,
    );
    const toolCallPromise = waitForEvent(charivo, "realtime:tool:call", client);
    const toolResultPromise = waitForEvent(
      charivo,
      "realtime:tool:result",
      client,
    );
    const expressionPromise = waitForEvent(
      charivo,
      "realtime:expression",
      client,
    );

    try {
      await realtimeManager.startSession({
        provider: "openai",
      });

      const sessionStart = await sessionStartPromise;
      expect(sessionStart.state.session.status).toBe("active");

      const bootstrap = client.bootstrap;
      expect(bootstrap).not.toBeNull();
      expect(isRealtimeSessionBootstrap(bootstrap)).toBe(true);
      expect(bootstrap).toMatchObject({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
      });
      expect("clientSecret" in bootstrap).toBe(true);

      await realtimeManager.sendMessage(
        "Please acknowledge this live smoke test with a brief smile.",
      );

      const toolCall = await toolCallPromise;
      expect(toolCall.name).toBe(SET_EXPRESSION_TOOL_NAME);

      const toolResult = await toolResultPromise;
      expect(toolResult.name).toBe(SET_EXPRESSION_TOOL_NAME);
      expect(toolResult.output).toMatchObject({
        success: true,
        expressionId: "Smile",
      });

      const expression = await expressionPromise;
      expect(expression).toEqual({ expressionId: "Smile" });
    } finally {
      await realtimeManager.stopSession().catch(() => undefined);
    }
  });
});

async function requestLiveBootstrap(
  session: RealtimeSessionConfig = {},
): Promise<RealtimeSessionBootstrap> {
  const request: RealtimeSessionRequest = {
    adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
    transport: "webrtc",
    session: {
      provider: "openai",
      ...session,
    },
  };

  const response = await POST(
    new Request("http://localhost/api/realtime", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }) as unknown as import("next/server").NextRequest,
  );

  if (!response.ok) {
    let details = response.statusText;

    try {
      const payload = (await response.json()) as Record<string, unknown>;
      details =
        typeof payload.error === "string"
          ? payload.error
          : JSON.stringify(payload);
    } catch {
      details = await response.text();
    }

    throw new Error(`Live realtime bootstrap failed: ${details}`);
  }

  const payload = (await response.json()) as unknown;
  if (!isRealtimeSessionBootstrap(payload)) {
    throw new Error(
      `Live realtime bootstrap returned an invalid payload: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

function hasTool(tools: RealtimeTool[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

function readFirstExpressionId(tools: RealtimeTool[]): string | null {
  const tool = tools.find(({ name }) => name === SET_EXPRESSION_TOOL_NAME);
  const expressionProperty = tool?.parameters.properties.expressionId as
    | { enum?: unknown }
    | undefined;
  const values = Array.isArray(expressionProperty?.enum)
    ? expressionProperty.enum
    : [];

  return typeof values[0] === "string" ? values[0] : null;
}

function readFirstMotion(
  tools: RealtimeTool[],
): { group: string; index: number } | null {
  const tool = tools.find(({ name }) => name === PLAY_MOTION_TOOL_NAME);
  const groupProperty = tool?.parameters.properties.group as
    | { enum?: unknown }
    | undefined;
  const groups = Array.isArray(groupProperty?.enum) ? groupProperty.enum : [];
  const group = groups[0];

  return typeof group === "string" ? { group, index: 0 } : null;
}

function waitForEvent<K extends keyof EventMap>(
  charivo: Charivo,
  event: K,
  client: LiveBootstrapSmokeClient,
  timeoutMs = 20_000,
): Promise<EventMap[K]> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      charivo.off(event, onEvent);
      reject(
        new Error(
          `Timed out waiting for ${String(event)}. Observed transport events: ${client.observedEvents.join(", ") || "(none)"}`,
        ),
      );
    }, timeoutMs);

    const onEvent = (payload: EventMap[K]) => {
      clearTimeout(timeoutId);
      charivo.off(event, onEvent);
      resolve(payload);
    };

    charivo.on(event, onEvent);
  });
}
