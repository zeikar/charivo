/**
 * Gemini Live smoke harness driver.
 *
 * Drives the real chain — `@charivo/core` → `@charivo/realtime` →
 * `@charivo/realtime/remote` → `@charivo/realtime/gemini` → this harness's
 * `/api/realtime` route → `@charivo/server/gemini`. The spike this replaced
 * measured with its own WebSocket client, its playback-route toggles and its
 * echo-mode selector; those questions are settled (README.md), and the
 * convergence gate the answers produced lives in the transport — so re-tuning
 * it means exercising that gate here rather than reimplementing it.
 */
import type {
  EventMap,
  RealtimeSessionConfig,
  ToolRegistration,
} from "@charivo/core";
import { Charivo } from "@charivo/core";
import { createRealtimeManager } from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import type { HarnessSnapshot, SmokeHarnessApi } from "../harness-types";

type SmokeWindow = Window & {
  __charivoSmoke?: SmokeHarnessApi;
};

/**
 * One object, used by both `prepareAudio()` and `startSession()` — see
 * `startSession()` for why they must agree. `provider` + `transport` are what
 * the remote client's adapter resolver reads to pick the Gemini Live adapter.
 */
const SESSION_CONFIG: RealtimeSessionConfig = {
  provider: "gemini",
  transport: "websocket",
  instructions: [
    "너는 친근한 한국어 대화 상대야.",
    "항상 한국어로만 대답해.",
    "날씨를 물어보면 반드시 getWeather 도구를 호출하고, 도구가 돌려준 값으로만 대답해.",
  ].join(" "),
};

/**
 * A dummy tool, present to observe the wire rather than to be useful: the
 * `toolCall` frame shape comes from the API reference and has never been seen
 * live. One argument, so `args` is observable too.
 */
const WEATHER_TOOL: ToolRegistration = {
  definition: {
    type: "function",
    name: "getWeather",
    description:
      "Return the current weather for a city. Call this whenever the user asks about the weather.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name, as the user said it.",
        },
      },
      required: ["city"],
    },
  },
  handler: (args) =>
    Promise.resolve({ city: args.city, summary: "맑음", temperatureC: 21 }),
};

const state: HarnessSnapshot = {
  sessionStatus: "idle",
  connection: "idle",
  assistantStatus: "idle",
  assistantCompletions: 0,
  assistantText: "",
  userTranscripts: [],
  toolCalls: [],
  lastError: null,
  events: [],
};

const charivo = new Charivo();
const realtimeClient = createRemoteRealtimeClient({
  apiEndpoint: "/api/realtime",
  // The transport's debug log is the tuning instrument: it prints how long
  // after playback started each interruption landed, and when the convergence
  // gate disarmed. Without it `CONVERGENCE_GATE_MS` can only be guessed at.
  debug: true,
});
const realtimeManager = createRealtimeManager(realtimeClient, {
  tools: [WEATHER_TOOL],
});

charivo.attachRealtime(realtimeManager);

const connectButton = requiredElement<HTMLButtonElement>("connect-button");
const disconnectButton =
  requiredElement<HTMLButtonElement>("disconnect-button");
const interruptButton = requiredElement<HTMLButtonElement>("interrupt-button");
const sendButton = requiredElement<HTMLButtonElement>("send-button");
const messageInput = requiredElement<HTMLInputElement>("message-input");
const sessionStatusElement = requiredElement<HTMLSpanElement>("session-status");
const assistantStatusElement =
  requiredElement<HTMLSpanElement>("assistant-status");
const lastErrorElement = requiredElement<HTMLSpanElement>("last-error");
const transcriptElement = requiredElement<HTMLPreElement>("transcript");
const eventLogElement = requiredElement<HTMLPreElement>("event-log");

const subscriptions = [
  "realtime:session:start",
  "realtime:session:end",
  "realtime:state",
  "realtime:user:transcript",
  "realtime:assistant:start",
  "realtime:assistant:delta",
  "realtime:assistant:done",
  "tool:call",
  "tool:result",
  "tool:error",
  "realtime:usage",
  "realtime:error",
  // Playback boundaries: the Safari convergence gate is anchored to the
  // character's voice becoming audible, so the live checks read interruption
  // offsets against these.
  "tts:audio:start",
  "tts:audio:end",
] as const satisfies ReadonlyArray<keyof EventMap>;

/**
 * `charivo.on` types its payload from the event name alone, so subscribing in a
 * loop widens it to every `EventMap` value at once. Re-pairing each payload
 * with the name it arrived under rebuilds a discriminated union the switch can
 * narrow.
 */
type HarnessEvent = {
  [K in (typeof subscriptions)[number]]: { event: K; payload: EventMap[K] };
}[(typeof subscriptions)[number]];

for (const eventName of subscriptions) {
  charivo.on(eventName, (payload) => {
    const harnessEvent = { event: eventName, payload } as HarnessEvent;
    const detail = applyHarnessEvent(harnessEvent);
    recordEvent(eventName, payload, detail);
    render();
  });
}

/**
 * Folds one event into the snapshot and returns the detail worth showing
 * beside its name in the log — one switch, so the two never disagree about
 * what an event carried.
 */
function applyHarnessEvent(harnessEvent: HarnessEvent): string {
  const { event: eventName, payload } = harnessEvent;

  switch (eventName) {
    case "realtime:session:start":
    case "realtime:session:end":
    case "realtime:state": {
      const realtimeState = payload.state;
      state.sessionStatus = realtimeState.session.status;
      state.connection = realtimeState.connection;
      state.assistantStatus = realtimeState.response.status;
      return `${realtimeState.connection}/${realtimeState.session.status}`;
    }

    case "realtime:user:transcript":
      state.userTranscripts.push(payload.text);
      appendTranscript(`user: ${payload.text}`);
      return payload.text;

    case "realtime:assistant:start":
      state.assistantStatus = "responding";
      state.assistantText = "";
      return "";

    case "realtime:assistant:delta":
      state.assistantText += payload.text;
      return payload.text;

    case "realtime:assistant:done":
      state.assistantStatus = "completed";
      state.assistantCompletions += 1;
      state.assistantText = payload.text;
      appendTranscript(`assistant: ${payload.text}`);
      return payload.text;

    case "tool:call":
      state.toolCalls.push({
        name: payload.name,
        callId: payload.callId,
        args: payload.args,
      });
      return `${payload.name} ${JSON.stringify(payload.args)}`;

    case "tool:result":
      return `${payload.name} ${JSON.stringify(payload.output)}`;

    case "tool:error":
    case "realtime:error":
      state.lastError = payload.error.message;
      return payload.error.message;

    default:
      return "";
  }
}

connectButton.addEventListener("click", () => {
  void startSession();
});
disconnectButton.addEventListener("click", () => {
  void stopSession();
});
interruptButton.addEventListener("click", () => {
  void interrupt();
});
sendButton.addEventListener("click", () => {
  void sendPrompt();
});

/**
 * `prepareAudio()` and `startSession()` take the same config inside the same
 * click: the config picks the adapter, so passing it to both is what lets
 * `connect()` reuse the instance whose `AudioContext` was built in the gesture.
 * Safari only unlocks such a context, which is the path the convergence-gate
 * check has to exercise.
 */
async function startSession(): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.prepareAudio(SESSION_CONFIG);
    await realtimeManager.startSession(SESSION_CONFIG);
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
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

async function interrupt(): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.interrupt();
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

function recordEvent<K extends keyof EventMap>(
  type: K,
  payload: EventMap[K],
  detail: string,
): void {
  const at = Date.now();
  state.events.push({ type, payload, at });
  appendLog(`${formatOffset(at)} ${type}${detail ? ` — ${detail}` : ""}`);
}

/** Seconds since the first event, which is the frame every live check reads in. */
function formatOffset(at: number): string {
  const first = state.events[0]?.at ?? at;
  return `+${((at - first) / 1000).toFixed(3)}s`;
}

function appendTranscript(line: string): void {
  transcriptElement.textContent += `${line}\n`;
}

function appendLog(line: string): void {
  eventLogElement.textContent += `${line}\n`;
  eventLogElement.scrollTop = eventLogElement.scrollHeight;
}

function render(): void {
  sessionStatusElement.textContent = `${state.connection}/${state.sessionStatus}`;
  assistantStatusElement.textContent = state.assistantStatus;
  lastErrorElement.textContent = state.lastError ?? "-";

  connectButton.disabled =
    state.sessionStatus === "active" || state.connection === "connecting";
  disconnectButton.disabled =
    state.sessionStatus !== "active" && state.connection !== "connecting";
  interruptButton.disabled = state.sessionStatus !== "active";
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
  interrupt,
  stopSession,
  getSnapshot: () => structuredClone(state),
};

window.addEventListener("beforeunload", () => {
  void stopSession();
});

render();
