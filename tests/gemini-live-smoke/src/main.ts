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
import type { Character, EventMap, RealtimeSessionConfig } from "@charivo/core";
import { Charivo } from "@charivo/core";
import {
  SET_EXPRESSION_TOOL_NAME,
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { AVATAR_CATALOG, SMOKE_AVATAR_CATALOG } from "../../avatar-catalog";
import type {
  HarnessMode,
  HarnessSnapshot,
  SmokeHarnessApi,
} from "../harness-types";

type SmokeWindow = Window & {
  __charivoSmoke?: SmokeHarnessApi;
};

const TEST_CHARACTER: Character = {
  id: "gemini-live-smoke-hiyori",
  name: "Hiyori",
  personality: "Gentle, attentive, and expressive in small moments.",
};

const HARNESS_MODE = resolveHarnessMode();

const ALL_TEST_TOOLS = createAvatarControlTools(AVATAR_CATALOG);

// Keep the smoke deterministic by exposing only setExpression.
const SMOKE_TEST_TOOLS = createAvatarControlTools(SMOKE_AVATAR_CATALOG).filter(
  (tool) => tool.definition.name === SET_EXPRESSION_TOOL_NAME,
);

const SMOKE_TEST_INSTRUCTIONS = [
  "너는 친근한 한국어 대화 상대야.",
  "항상 한국어로만 대답해.",
  '웃어달라고 하면 setExpression을 expressionId "Smile"로 정확히 한 번 호출해.',
  "도구가 끝나면 짧은 한 문장으로 말해주고, 다시 요청받기 전에는 도구를 또 호출하지 마.",
].join(" ");

const ACTIVE_TOOLS =
  HARNESS_MODE === "avatar-prompt-eval" ? ALL_TEST_TOOLS : SMOKE_TEST_TOOLS;

/**
 * One object, used by both `prepareAudio()` and `startSession()` — see
 * `startSession()` for why they must agree. `provider` + `transport` are what
 * the remote client's adapter resolver reads to pick the Gemini Live adapter.
 */
const SESSION_CONFIG: RealtimeSessionConfig = {
  provider: "gemini",
  transport: "websocket",
  instructions:
    HARNESS_MODE === "avatar-prompt-eval"
      ? buildAvatarPromptEvalInstructions()
      : SMOKE_TEST_INSTRUCTIONS,
};

const state: HarnessSnapshot = {
  mode: HARNESS_MODE,
  sessionStatus: "idle",
  connection: "idle",
  assistantStatus: "idle",
  assistantCompletions: 0,
  assistantText: "",
  userTranscripts: [],
  registeredTools: ACTIVE_TOOLS.map((tool) => tool.definition.name),
  sessionInstructions: null,
  toolCalls: [],
  avatarEvents: [],
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
  tools: ACTIVE_TOOLS,
  resultProjectors: [createAvatarResultProjector()],
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
  "avatar:expression",
  "avatar:motion",
  "avatar:gaze",
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
      state.sessionInstructions =
        realtimeState.session.config?.instructions ?? null;
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

    case "avatar:expression":
      state.avatarEvents.push({
        type: "expression",
        expressionId: payload.expressionId,
      });
      return payload.expressionId;

    case "avatar:motion":
      state.avatarEvents.push({
        type: "motion",
        group: payload.group,
        index: payload.index,
        muteSound: payload.muteSound,
      });
      return `${payload.group} #${String(payload.index)}`;

    case "avatar:gaze":
      state.avatarEvents.push({
        type: "gaze",
        x: payload.x,
        y: payload.y,
      });
      return `x ${String(payload.x)}, y ${String(payload.y)}`;

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

/**
 * The evaluation mode deliberately sends what a real app would: the default
 * `@charivo/realtime` character instructions plus the avatar addendum, so the
 * opaque expression IDs reach the model only through the descriptions the
 * addendum and the `setExpression` schema carry.
 */
function buildAvatarPromptEvalInstructions(): string {
  const baseInstructions = buildRealtimeSessionConfig({
    character: TEST_CHARACTER,
  }).instructions;

  return [
    baseInstructions,
    buildAvatarControlInstructions(AVATAR_CATALOG),
  ].join("\n");
}

function resolveHarnessMode(): HarnessMode {
  const mode = new URL(window.location.href).searchParams.get("mode");

  return mode === "avatar-prompt-eval" ? mode : "smoke";
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
