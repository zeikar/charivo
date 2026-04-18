import { Charivo, type Character, type EventMap } from "@charivo/core";
import { createRemoteRealtimeClient } from "@charivo/realtime-client-remote";
import {
  SET_EXPRESSION_TOOL_NAME,
  createAvatarControlTools,
  createRealtimeManager,
} from "@charivo/realtime-core";
import type { HarnessSnapshot, SmokeHarnessApi } from "../harness-types";

type SmokeWindow = Window & {
  __charivoSmoke?: SmokeHarnessApi;
};

const TEST_CHARACTER: Character = {
  id: "webrtc-smoke-hiyori",
  name: "Hiyori",
  personality: "Gentle, attentive, and expressive in small moments.",
};

// Keep the smoke deterministic by exposing only setExpression.
const TEST_TOOLS = createAvatarControlTools({
  expressions: ["Smile"],
  motions: {},
}).filter((tool) => tool.definition.name === SET_EXPRESSION_TOOL_NAME);

const TEST_INSTRUCTIONS = [
  "You are Hiyori.",
  "Stay fully in character.",
  'When the user asks you to smile, call setExpression exactly once with expressionId "Smile".',
  "After the tool returns, continue with one short spoken reply and do not call the tool again unless the user asks again.",
  "Do not call any other tool.",
  "Reply in one short sentence.",
].join(" ");

const state: HarnessSnapshot = {
  sessionStatus: "idle",
  connection: "idle",
  assistantStatus: "idle",
  assistantText: "",
  lastError: null,
  toolCalls: [],
  avatarEvents: [],
  events: [],
};

const charivo = new Charivo();
const realtimeClient = createRemoteRealtimeClient({
  apiEndpoint: "/api/realtime",
});
const realtimeManager = createRealtimeManager(realtimeClient, {
  tools: TEST_TOOLS,
});

charivo.attachRealtime(realtimeManager);
charivo.setCharacter(TEST_CHARACTER);

const connectButton = requiredElement<HTMLButtonElement>("connect-button");
const disconnectButton =
  requiredElement<HTMLButtonElement>("disconnect-button");
const sendButton = requiredElement<HTMLButtonElement>("send-button");
const messageInput = requiredElement<HTMLInputElement>("message-input");
const sessionStatusElement = requiredElement<HTMLSpanElement>("session-status");
const assistantStatusElement =
  requiredElement<HTMLSpanElement>("assistant-status");
const lastErrorElement = requiredElement<HTMLSpanElement>("last-error");
const assistantTextElement = requiredElement<HTMLPreElement>("assistant-text");
const eventLogElement = requiredElement<HTMLPreElement>("event-log");

const subscriptions: Array<keyof EventMap> = [
  "realtime:session:start",
  "realtime:session:end",
  "realtime:state",
  "realtime:assistant:start",
  "realtime:assistant:delta",
  "realtime:assistant:done",
  "realtime:tool:call",
  "realtime:tool:result",
  "realtime:tool:error",
  "realtime:expression",
  "realtime:motion",
  "realtime:gaze",
  "realtime:error",
];

for (const eventName of subscriptions) {
  charivo.on(eventName, (payload) => {
    recordEvent(eventName, payload);

    switch (eventName) {
      case "realtime:session:start":
      case "realtime:session:end":
      case "realtime:state": {
        const realtimeState = payload.state;
        state.sessionStatus = realtimeState.session.status;
        state.connection = realtimeState.connection;
        state.assistantStatus = realtimeState.response.status;
        if (realtimeState.response.text) {
          state.assistantText = realtimeState.response.text;
        }
        break;
      }

      case "realtime:assistant:start":
        state.assistantStatus = "responding";
        state.assistantText = "";
        break;

      case "realtime:assistant:delta":
        state.assistantText += payload.text;
        break;

      case "realtime:assistant:done":
        state.assistantStatus = "completed";
        state.assistantText = payload.text;
        break;

      case "realtime:tool:call":
        state.toolCalls.push({ name: payload.name, callId: payload.callId });
        break;

      case "realtime:expression":
        state.avatarEvents.push({
          type: "expression",
          expressionId: payload.expressionId,
        });
        break;

      case "realtime:motion":
        state.avatarEvents.push({
          type: "motion",
          group: payload.group,
          index: payload.index,
        });
        break;

      case "realtime:gaze":
        state.avatarEvents.push({
          type: "gaze",
          x: payload.x,
          y: payload.y,
        });
        break;

      case "realtime:tool:error":
      case "realtime:error":
        state.lastError = payload.error.message;
        break;

      default:
        break;
    }

    render();
  });
}

connectButton.addEventListener("click", () => {
  void startSession();
});
disconnectButton.addEventListener("click", () => {
  void stopSession();
});
sendButton.addEventListener("click", () => {
  void sendPrompt();
});

async function startSession(): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.startSession({
      provider: "openai",
      toolChoice: "auto",
      instructions: TEST_INSTRUCTIONS,
    });
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
  }
}

async function stopSession(): Promise<void> {
  try {
    await realtimeManager.stopSession();
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
  }
}

async function sendPrompt(text = messageInput.value): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.sendMessage(text);
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
  }
}

function recordEvent<K extends keyof EventMap>(
  type: K,
  payload: EventMap[K],
): void {
  state.events.push({
    type,
    payload,
    at: Date.now(),
  });
}

function render(): void {
  sessionStatusElement.textContent = `${state.connection}/${state.sessionStatus}`;
  assistantStatusElement.textContent = state.assistantStatus;
  lastErrorElement.textContent = state.lastError ?? "-";
  assistantTextElement.textContent = state.assistantText || "(empty)";
  eventLogElement.textContent = JSON.stringify(state, null, 2);

  connectButton.disabled =
    state.sessionStatus === "active" || state.connection === "connecting";
  disconnectButton.disabled =
    state.sessionStatus !== "active" && state.connection !== "connecting";
  sendButton.disabled = state.sessionStatus !== "active";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  return element as T;
}

const smokeWindow = window as SmokeWindow;
smokeWindow.__charivoSmoke = {
  startSession,
  sendPrompt,
  stopSession,
  getSnapshot: () => structuredClone(state),
};

window.addEventListener("beforeunload", () => {
  void stopSession();
});

render();
