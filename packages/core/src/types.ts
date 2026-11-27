import type { CharivoError } from "./errors";

export interface MotionSelection {
  group: string;
  index?: number;
}

/**
 * What a performance or reaction should show.
 *
 * - `expression` as a string is an expression id, used as is.
 * - `expression` as `{ affect, intensity? }` resolves through the
 *   {@link AffectMap} set with `setAffectMap()`. No map, an unknown label or
 *   no qualifying entry resolves to nothing.
 * - `motion` is this cue's own when given, else the chosen map entry's.
 */
export interface AffectCue {
  expression?:
    | string
    | {
        affect: string;
        /** Defaults to 0.5 and is clamped to 0..1. */
        intensity?: number;
      };
  motion?: MotionSelection;
}

/** What one affect label shows at or above `minIntensity`. */
export interface AffectMapEntry {
  expressionId?: string;
  motion?: MotionSelection;
  /** Defaults to 0. */
  minIntensity?: number;
}

/**
 * Affect label -> one entry or a list of them, for the loaded model; set it
 * again when the model changes. A cue picks, among its label's entries, the
 * one with the highest `minIntensity` not above the cue's intensity.
 */
export type AffectMap = Record<string, AffectMapEntry | AffectMapEntry[]>;

export interface GazeCoordinates {
  x: number;
  y: number;
}

/**
 * How strongly an avatar claim competes, highest first: `reflex`, `explicit`,
 * `inferred`, `ambient`. On a held channel the highest live claim wins and a
 * tie goes to the newest. Defaults to `"explicit"` when a claim omits it.
 */
export type AvatarClaimPriority =
  | "reflex"
  | "explicit"
  | "inferred"
  | "ambient";

/**
 * How long a held claim (expression or gaze) stays live.
 *
 * - `{ ms }`: until the timer fires; `ms` must be a positive finite number of
 *   at most 2,147,483,647 (the `setTimeout` limit) or the claim is ignored.
 * - `"until-release"`: until `avatar:release` names its source or the same
 *   source claims again.
 * - `{ performance: id }`: until `performance:end` for that id.
 *
 * Omitted, the channel default applies: an expression is bound to the speech
 * in progress (or the next one that starts soon), a gaze lasts 1,200 ms.
 */
export type AvatarHold =
  | { ms: number }
  | "until-release"
  | { performance: string };

/**
 * Optional claim fields carried by `avatar:expression` and `avatar:gaze`.
 * Every field is optional so existing emitters stay valid.
 */
export interface AvatarClaimOptions {
  /** Who holds the claim; a new claim replaces the same source's previous one. Defaults to `"app"`. */
  source?: string;
  /** Defaults to `"explicit"`. */
  priority?: AvatarClaimPriority;
  /** Defaults to the channel's hold (see {@link AvatarHold}). */
  hold?: AvatarHold;
  /**
   * Identifies this claim. `RenderManager` stores it with the claim it
   * accepts, so an `avatar:release` naming the same id ends this claim and
   * never a newer one from the same source.
   */
  claimId?: string;
}

/**
 * Renderer-level motion priority, mapped from {@link AvatarClaimPriority}:
 * `reflex` -> `"force"` (cuts any running motion), `explicit` / `inferred` ->
 * `"normal"`, `ambient` -> `"idle"` (plays only when nothing else is).
 * Absent means `"normal"`.
 */
export type MotionPriority = "idle" | "normal" | "force";

/** How a performance ended, reported by `performance:end`. */
export type PerformanceStatus = "completed" | "cancelled" | "failed";

/**
 * A line for `perform()`. `perform()` throws `CharivoStateError` synchronously
 * when `text` is neither a string nor an async iterable, while realtime holds
 * playback, from a `dispose()` call until its teardown is done, or when the
 * floor is held and `whenBusy` is `"reject"`; otherwise it holds the floor
 * before it returns.
 */
export interface PerformRequest {
  /**
   * A string is performed as given, the empty string included. An async
   * iterable is cut into sentences and spoken segment by segment.
   */
  text: string | AsyncIterable<string>;
  /** Who asked for the performance. Defaults to `"app"`. */
  origin?: string;
  /**
   * When the floor is held: `"interrupt"` (default) cancels the holder and
   * takes the floor; `"reject"` throws `CharivoStateError`.
   */
  whenBusy?: "interrupt" | "reject";
  affect?: AffectCue;
}

/** How a performance ended; the value `PerformanceHandle.done` resolves with. */
export interface PerformanceResult {
  status: PerformanceStatus;
  /** The line, for a string; for a stream, everything read from the iterator. */
  text: string;
  /**
   * The full `text` on `completed`. Otherwise, for a string, `""` only when
   * playback demonstrably had not begun: `speak()` was not yet called, or the
   * manager it was called on takes an event emitter and no `tts:audio:start`
   * has been heard since; in every other case it is omitted. For a stream, the
   * part of `text` up to the end of the last segment whose speech (its render,
   * when unvoiced) finished.
   */
  heardText?: string;
  /**
   * Set on a `failed` render or TTS step. A stream whose iterator rejected
   * fails with `error` and no `failedAt`.
   */
  failedAt?: "render" | "tts";
  error?: CharivoError;
}

/**
 * One performance on the floor, returned by `perform()`. Named
 * `PerformanceHandle` rather than `Performance`, which is a DOM global.
 */
export interface PerformanceHandle {
  /** The id carried by the performance's events and its rendered message. */
  id: string;
  /**
   * `true` once the line (for a stream, its first segment) has rendered, or
   * reached that step with no render manager attached, before any speech and
   * never inside the `perform()` call; `false` when the performance
   * ended before that point. Never rejects.
   */
  started: Promise<boolean>;
  /** Resolves when the performance ends. Never rejects. */
  done: Promise<PerformanceResult>;
  /**
   * The value `done` resolves with, readable synchronously from the moment the
   * performance ends; `undefined` before.
   */
  readonly result: PerformanceResult | undefined;
  /**
   * Ends the performance as `cancelled` at once and stops its speech when a
   * `speak()` is in flight. Rejects with the typed provider error when that
   * stop fails. A repeated call returns the first call's outcome; on a
   * performance that ended on its own it resolves and stops nothing.
   */
  cancel(): Promise<void>;
}

/**
 * A reaction for `react()`. It never takes the floor: it emits
 * `avatar:expression` for the resolved expression and `avatar:gaze` for
 * `gaze` (both with this `source`, `hold` and `priority`, and a `claimId`
 * fresh for this reaction), and a muted `avatar:motion` for the resolved
 * motion.
 */
export interface ReactRequest extends AffectCue {
  gaze?: GazeCoordinates;
  source: string;
  hold: AvatarHold;
  /** Defaults to `"reflex"`. */
  priority?: AvatarClaimPriority;
  /**
   * Also cancels the performance on the floor, whether or not the cue
   * resolved. Allowed with priority `"reflex"` only: any other priority throws
   * `CharivoStateError` before anything is emitted.
   */
  critical?: boolean;
}

/** Returned by `react()`. */
export interface ReactionHandle {
  /** What the cue resolved to; empty when it resolved to nothing. */
  resolved: { expressionId?: string; motion?: MotionSelection };
  /**
   * Emits, once, an `avatar:release` with this reaction's `claimId` for each
   * held channel (expression, gaze) it claimed, so it never clears a newer
   * claim from the same source.
   */
  release(): void;
}

/**
 * Who holds playback: nobody, a performance, or a realtime manager (attached
 * from `attachRealtime()` to `detachRealtime()`, with no performance id).
 * `floor:changed` reports every change.
 */
export type FloorState =
  | { state: "idle" }
  | { state: "speaking"; performanceId: string; origin: string }
  | { state: "realtime" };

/** The body a conversation brain drives; `Charivo` implements it. */
export interface CharacterBody extends CharivoEventBus {
  perform(request: PerformRequest): PerformanceHandle;
  react(request: ReactRequest): ReactionHandle;
  /**
   * Speech only: cancels the performance on the floor, stops speech that is
   * still unsettled, and stops the attached TTS manager when that cancel
   * supplied no stop. Rejects with the typed provider error of the first stop
   * that failed.
   */
  interrupt(): Promise<void>;
  getFloor(): FloorState;
}

/**
 * The conversation brain `Charivo` hosts: it decides what the character says
 * and drives the {@link CharacterBody} to say it. Attach one with
 * `Charivo.attachBrain()`.
 */
export interface ConversationBrain {
  /** Called by `attachBrain` with the body, and by `detachBrain` with `null`. */
  setBody(body: CharacterBody | null): void;
  setCharacter(character: Character): void;
  /**
   * Hands the brain one input. Latest wins: an input that responds retires
   * the live turn. The busy policy lives on `perform()` only. Throws
   * `CharivoStateError` when no body is attached.
   */
  submit(input: BrainInput): BrainTurn;
  /**
   * Cancels the live turn and its performance. Resolves when the cancel of
   * that performance has settled, and rejects with the error of its stop.
   * Does nothing when no turn is live.
   */
  interrupt(): Promise<void>;
  clearHistory(): void;
  getHistory(): Message[];
  dispose?(): void | Promise<void>;
}

/** One input's journey through a {@link ConversationBrain}. */
export interface BrainTurn {
  /** The id of the `Message` the input resolved to, as in `message:sent`. */
  id: string;
  /**
   * Settles when the turn does, with its outcome. Never rejects: a failure
   * is a `failed` result.
   */
  done: Promise<BrainTurnResult>;
  /**
   * Retires this turn, as a newer responding input would, without a
   * successor. Resolves when the cancel of its performance has and rejects
   * with that stop's error. Does nothing once the turn is no longer live.
   */
  cancel(): Promise<void>;
}

/**
 * How a {@link BrainTurn} ended. A `failed` result names the `stage` that
 * failed:
 * - `generate`: producing the reply (the request, the history write, a
 *   `review` hook) failed.
 * - `render`: showing the reply failed; the input is kept, the reply dropped.
 * - `tts`: speaking the reply failed (or playback was reserved by realtime);
 *   `text` is the reply, which stays in history when it was committed.
 */
export type BrainTurnResult =
  | { status: "completed" | "cancelled"; text: string; heardText?: string }
  | { status: "silent" }
  | {
      status: "failed";
      stage: "generate" | "render" | "tts";
      text: string;
      error: CharivoError;
    };

export interface AvatarControlCatalog {
  expressions: string[];
  motions: Record<string, number>;
  /**
   * Optional semantic descriptions for each expression.
   * Keys should correspond to IDs in the `expressions` array.
   * Entries whose key is not present in `expressions` are ignored by consumers.
   * When omitted or empty, no semantic hints are provided (preserving today's behavior).
   */
  expressionDescriptions?: Record<string, string>;
  /**
   * Optional semantic descriptions for each motion.
   * Keys should correspond to group names in `motions`; a group's array is
   * positional, so index 0 describes motion index 0.
   * Groups not present in `motions`, and indices at or beyond a group's count,
   * are ignored by consumers.
   * When omitted or empty, no semantic hints are provided (preserving today's behavior).
   */
  motionDescriptions?: Record<string, string[]>;
}

export interface Character {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  avatar?: string;
  voice?: {
    voiceId?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  };
}

/**
 * What a history entry is, which decides how it reaches the model:
 * - `user`: a person speaking to the character.
 * - `character`: the character's own reply.
 * - `system`: an instruction at system level.
 * - `event`: something that happened (a game event, a donation), reported by
 *   `source`. It is data from outside the app, so it is never projected at
 *   system authority.
 * - `direction`: a private stage direction from the app (a show director's
 *   cue). It is not speech by anyone in the conversation.
 */
export type MessageType =
  | "user"
  | "character"
  | "system"
  | "event"
  | "direction";

export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  characterId?: string;
  type: MessageType;
  /**
   * Who produced the entry: the speaker's name on a `user` message (several
   * viewers can share one conversation), the reporting source on an `event`
   * (required there). Ignored on the other types.
   */
  source?: string;
}

/**
 * Whether an input asks the character to reply:
 * - `must`: reply to it.
 * - `auto`: the brain decides whether a reply is due.
 * - `silent`: never reply; the input only informs.
 */
export type BrainRespond = "must" | "auto" | "silent";

/**
 * What happens to an input in the conversation history:
 * - `keep`: stored like any other turn.
 * - `ephemeral`: shown to the model for this request only, never stored.
 * - `{ replaceKey }`: stored, replacing the entry kept under the same key, so
 *   only the latest state of something (a game score, the current scene)
 *   occupies the history.
 *
 * Independent of {@link BrainRespond}: a reply, when one is made, is always
 * kept whatever the input's policy.
 */
export type BrainHistoryPolicy = "keep" | "ephemeral" | { replaceKey: string };

/**
 * Typed input for a character brain. Defaults when a field is omitted:
 * `user` must/keep, `event` auto/keep, `direction` must/ephemeral.
 */
export type BrainInput =
  | {
      kind: "user";
      text: string;
      /** The speaker's name, shown to the model as `<speaker>: <text>`. */
      speaker?: string;
      respond?: BrainRespond;
      history?: BrainHistoryPolicy;
    }
  | {
      kind: "event";
      /** Who reports the event, e.g. `"game"`. */
      source: string;
      text: string;
      respond?: BrainRespond;
      history?: BrainHistoryPolicy;
    }
  | {
      kind: "direction";
      text: string;
      respond?: BrainRespond;
      history?: BrainHistoryPolicy;
    };

export type RealtimeTransportKind = "webrtc" | "websocket";

export type RealtimeToolChoice = "auto" | "none" | "required";
export const OPENAI_REALTIME_ADAPTER = "openai-webrtc";
export const OPENAI_REALTIME_AGENTS_ADAPTER = "openai-agents-webrtc";
export const GEMINI_LIVE_ADAPTER = "gemini-live-websocket";

// Modality-neutral tool contracts (used by realtime and LLM sessions)
export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  /**
   * JSON Schema-shaped. `validateToolArguments` only enforces required-key
   * presence, enum membership, and each property's top-level `type`; nested
   * schemas, `additionalProperties`, and numeric-length constraints are not
   * validated.
   */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolContext {
  character?: Character | null;
  callId?: string;
  /** Present only for realtime sessions. */
  state?: RealtimeState;
}

/** Must resolve to a plain object; arrays and primitives are rejected by the runners. */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<Record<string, unknown>>;

export interface ToolRegistration {
  definition: ToolDefinition;
  handler: ToolHandler;
  /** Timeout in ms; falls back to the manager default when omitted. */
  timeoutMs?: number;
}

export interface ToolResultProjectorContext {
  name: string;
  output: Record<string, unknown>;
  callId?: string;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}

export type ToolResultProjector = (context: ToolResultProjectorContext) => void;

export interface RealtimeSessionConfig {
  provider?: string;
  transport?: RealtimeTransportKind;
  voice?: string;
  model?: string;
  instructions?: string;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: RealtimeToolChoice;
  /**
   * Off unless asked, on every provider. `{ enabled: true }` turns it on with
   * the provider's default transcription model; a `model` implies on where the
   * provider offers a choice (OpenAI) and is rejected where it does not
   * (Gemini); `{ enabled: false }` turns it off.
   */
  inputAudioTranscription?: {
    model?: string;
    enabled?: boolean;
  };
}

export interface RealtimeSessionRequest {
  adapter?: string;
  transport: RealtimeTransportKind;
  session: RealtimeSessionConfig;
  sdpOffer?: string;
}

export type RealtimeSessionBootstrap =
  | {
      adapter: string;
      transport: "webrtc";
      answerSdp: string;
    }
  | {
      adapter: string;
      transport: "webrtc";
      clientSecret: string;
    }
  | {
      adapter: string;
      transport: "websocket";
      url: string;
      token: string;
    };

export interface RealtimeProvider {
  createSession(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap>;
}

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

export type RealtimeReconnectCause =
  | "ice-disconnected"
  | "ice-failed"
  | "connection-failed"
  | "offline"
  | "online"
  | "visibility"
  | "pagehide"
  | "pageshow";

export type RealtimeSessionStatus = "idle" | "starting" | "active" | "stopped";
export type RealtimeSessionTransitionReason = "user" | "refresh";

export type RealtimeResponseStatus =
  | "idle"
  | "responding"
  | "interrupted"
  | "completed";

export interface RealtimeState {
  connection: RealtimeConnectionState;
  session: {
    status: RealtimeSessionStatus;
    config: RealtimeSessionConfig | null;
    characterId?: string;
  };
  response: {
    status: RealtimeResponseStatus;
    text: string;
  };
  /**
   * Whether the character is still audible. Outlasts `response.status`, which
   * completes when the provider stops sending while playback runs on.
   */
  audioPlaying: boolean;
  /**
   * Whether a reply is still expected. Wider than
   * `response.status === "responding"` — it also covers the gap before the
   * reply starts streaming. Only the response-in-progress refusal; an inactive
   * or reconnecting session is rejected separately.
   */
  awaitingResponse: boolean;
  lastError: Error | null;
}

export interface RealtimeUsageEvent {
  usage: Record<string, unknown>;
  model?: string;
  responseId?: string;
  sessionId?: string;
}

export interface LLMAdapter {
  generateResponse(message: Message): Promise<string>;
  setCharacter(character: Character): void;
  clearHistory(): void;
}

export interface LLMToolCall {
  id: string;
  name: string;
  /** JSON-decoded; the provider/client adapter parses the raw tool-call arguments before this contract is used. */
  arguments: Record<string, unknown>;
}

/**
 * Role-discriminated union so protocol-invalid combinations are unrepresentable
 * for typed direct callers: unknown roles, tool turns without an ID, and tool
 * calls on user turns cannot be expressed.
 */
export type LLMMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: LLMToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export interface LLMToolResponse {
  content: string;
  toolCalls?: LLMToolCall[];
}

// LLM provider (generates LLM responses server-side)
export interface LLMProvider {
  generateResponse(messages: LLMMessage[]): Promise<string>;
  /** Tool-calling variant; providers that support function calling implement this alongside generateResponse. */
  generateResponseWithTools?(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse>;
}

/**
 * Transport-level cancellation for a single `LLMClient` call. Implementations
 * that do not support cancellation may ignore the field.
 */
export interface LLMCallOptions {
  signal?: AbortSignal;
}

// Simple LLM call client (stateless)
export interface LLMClient {
  call(messages: LLMMessage[], options?: LLMCallOptions): Promise<string>;
  /** Tool-calling variant; clients that support function calling implement this alongside call. */
  callWithTools?(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    options?: LLMCallOptions,
  ): Promise<LLMToolResponse>;
}

/**
 * Undoes a single `addToHistory` call. Idempotent: invoking it more than once
 * changes nothing after the first call.
 */
export type HistoryRollback = () => void;

export interface GenerateResponseOptions {
  /**
   * The caller has already placed the message in history via `addToHistory`
   * and commits the reply itself, so the manager must perform no history
   * writes for this call — no append, no reply commit, no rollback on
   * failure. Character and message validation and prompt building are
   * unchanged; the prompt still comes from history, which already holds the
   * message.
   */
  callerOwnsHistory?: boolean;
  /**
   * Reports that this call has been superseded, so it should stop doing work
   * on the caller's behalf. It is consulted before each new unit of tool work
   * — before each tool call in a round, between a call's `tool:call` emission
   * and its handler, and before each follow-up request — and on every
   * projected emission, including repeated emissions from inside a single
   * projector. Once it returns `true` the call starts nothing further and
   * projects nothing further, then resolves with the latest response text.
   *
   * It does not govern history writes, and it does not abort an already-
   * running handler, so tool side effects are not rolled back. Cancelling an
   * in-flight request is `signal`'s job, not this predicate's - see `signal`
   * below. Note the resulting event split: `tool:call` records an attempted,
   * dispatched call and can be the last event for a call whose handler was
   * skipped, while `tool:result` and `tool:error` report a handler that
   * actually ran.
   */
  isCancelled?: () => boolean;
  /**
   * Cancellation for the in-flight LLM call, forwarded to the client as
   * `LLMCallOptions.signal` on every `call`/`callWithTools` request this turn
   * makes, tool rounds included. Distinct from `isCancelled`: `isCancelled`
   * gates new work between steps and never aborts an in-flight request;
   * `signal` is what aborts the request itself. Whether an abort actually
   * cancels the transport depends on the client - clients that ignore
   * `LLMCallOptions.signal` (allowed by the contract) run to completion
   * regardless. A mid-request abort surfaces as a rejection, which a
   * latest-wins caller swallows via its own stale-turn check rather than this
   * manager doing anything special with it.
   */
  signal?: AbortSignal;
  /**
   * Show the message to the model for this request without storing it. The
   * prompt is the history plus the message; nothing about the message is
   * written, on success or failure. The reply is still committed, as a
   * standalone reply (see `AddToHistoryOptions.standalone`), unless
   * `callerOwnsHistory` is set. Pass a message that is not in history: one
   * that already is would appear twice.
   */
  ephemeral?: boolean;
  /**
   * Takes a projected event for this request instead of emitting it:
   * returning `true` consumes the event, returning `false` lets it through
   * to the event emitter as usual. Called for every event the request
   * projects (tool results shown on the avatar), in order, so the caller can
   * hold back what it will present itself, such as the last
   * `avatar:expression`.
   */
  interceptProjection?: (event: string, payload: unknown) => boolean;
}

export interface AddToHistoryOptions {
  /**
   * Store the message as the entry for this key, removing the message
   * previously stored under it, if that is still in history. The new entry
   * goes to the end, where the latest state belongs.
   */
  replaceKey?: string;
  /**
   * The message is a reply with no stored input (the input was ephemeral or
   * never stored). Pruning never treats it as a reply that lost its prompt.
   */
  standalone?: boolean;
}

// LLM manager (session management, history, character management)
export interface LLMManager {
  setCharacter(character: Character): void;
  getCharacter(): Character | null;
  clearHistory(): void;
  getHistory(): Message[];
  /**
   * Ensure `message` is present in this manager's history, synchronously —
   * it appends and returns a handle, never a promise — and without emitting
   * events or calling back into the caller (the cascade brain).
   *
   * A message this manager cannot store is rejected with a typed state error
   * (`CharivoStateError`). In the built-in manager every type except
   * `character` needs non-empty string content, and an `event` also needs a
   * non-empty `source`; a `type: "character"` message is stored exactly as
   * produced, empty content included.
   *
   * Appends only when that exact object is not already present (reference
   * identity, not id), then holds the configured history bound. The returned
   * handle removes the message if it is still present and restores what *this*
   * call evicted, but only when no other write has intervened. When nothing
   * was appended — the object was already there — the call mutates nothing and
   * returns a no-op handle, so it can neither delete the message nor
   * invalidate an earlier handle.
   *
   * With `replaceKey`, the message previously stored under that key is
   * removed too, and the handle puts it back where it was (same condition:
   * no intervening write).
   */
  addToHistory(
    message: Message,
    options?: AddToHistoryOptions,
  ): HistoryRollback;
  generateResponse(
    message: Message,
    options?: GenerateResponseOptions,
  ): Promise<string>;
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
  registerTool?(tool: ToolRegistration): void;
  unregisterTool?(name: string): void;
  getRegisteredTools?(): ToolDefinition[];
  /** System-prompt-level instructions injected only when tools are registered; pass null to clear. */
  setToolInstructions?(instructions: string | null): void;
}

/**
 * `LLMManager` with the tool-calling members required instead of optional.
 * Third-party `LLMManager` implementations may omit tool support, but the
 * built-in manager returned by `createLLMManager` always provides it.
 */
export interface LLMManagerWithTools extends LLMManager {
  setEventEmitter(eventEmitter: CharivoEventEmitter): void;
  registerTool(tool: ToolRegistration): void;
  unregisterTool(name: string): void;
  getRegisteredTools(): ToolDefinition[];
  setToolInstructions(instructions: string | null): void;
}

// Renderer interface (stateless renderer)
export interface Renderer {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  render(message: Message, character?: Character): Promise<void>;
  loadModel?(modelPath: string): Promise<void>;
  setRealtimeLipSync?(enabled: boolean): void;
  /** `rms` is the final 0..1 mouth opening from `tts:lipsync:update`; apply it without extra gain. */
  updateRealtimeLipSyncRms?(rms: number): void;
  playExpression?(expressionId: string): void;
  /** Releases the active expression so the model returns to its base face — implementations may fade it out rather than snapping; renderers without expression state omit it. */
  stopExpression?(): void;
  /**
   * `options.muteSound` asks for the motion without its baked-in sample clip; renderers with no motion audio may ignore it, and omitting it keeps the clip audible.
   * `options.priority` lets the renderer decide against the motion actually running (absent means `"normal"`); a renderer without motion priorities may ignore it and play every motion.
   * Returns `false` when the renderer declined the motion (a lower priority than the one running, no such clip, no model); `true` or nothing means it was accepted, so a renderer that returns nothing still fits.
   */
  playMotionByGroup?(
    group: string,
    index: number,
    options?: { muteSound?: boolean; priority?: MotionPriority },
  ): boolean | void;
  lookAt?(coords: GazeCoordinates): void;
  /**
   * Drops the target a `lookAt` set so the renderer's own resting gaze resumes.
   * `RenderManager` calls it when the last gaze claim ends; without it the last
   * claimed target stays until the next cursor or local-gaze input.
   */
  clearGaze?(): void;
  getAvailableExpressions?(): string[];
  getAvailableMotionGroups?(): Record<string, number>;
  /**
   * The loaded model's avatar control catalog — the renderer is its single
   * source: names, counts and descriptions. A renderer whose model carries
   * descriptions (an `.iki` file declares one per expression and motion)
   * returns them; others may return names and counts only. It reflects the
   * model loaded at call time, so read it after `loadModel` resolves and again
   * when the model changes. Apps should prefer it over assembling the catalog
   * from `getAvailableExpressions` / `getAvailableMotionGroups` themselves.
   */
  getAvatarControlCatalog?(): AvatarControlCatalog;
}

// Render manager (session management, lip-sync, motion control)
export interface RenderManager {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  setCharacter(character: Character): void;
  render(message: Message, character?: Character): Promise<void>;
  /** Local-presence gaze (webcam), peer of mouse-tracking. Returns true when applied; a manager with no gaze control returns false. */
  setLocalGaze(coords: GazeCoordinates): boolean;
  setEventBus(eventBus: CharivoEventBus): void;
  /** Removes all event-bus listeners registered by setEventBus and releases any held expression. */
  disconnect(): void;
  /** Loads the model through the renderer's `loadModel`; resolves without loading anything when the renderer has none. */
  loadModel(modelPath: string): Promise<void>;
  /** Sets the callback the manager invokes with each message once the renderer has rendered it; a later call replaces it. */
  setMessageCallback(
    callback: (message: Message, character?: Character) => void,
  ): void;
}

export interface TTSOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string;
}

export type TTSPlaybackMode = "audio" | "web-speech";

/**
 * Raw PCM carries no container, so the sample layout can't be sniffed from
 * the bytes the way a WAV/MP3 buffer can — it has to ride along with the
 * stream itself.
 */
export interface TTSPcmFormat {
  encoding: "pcm-s16le";
  sampleRate: number;
  /** Mono only — the TTS manager rejects a stream declaring any other count. */
  channels: number;
}

/**
 * A streamed TTS result. `format` always describes `pcm-s16le`, regardless
 * of any vendor label on the request, since every streaming provider decodes
 * to that layout before handing the stream back.
 */
export interface TTSPcmStream {
  body: ReadableStream<Uint8Array>;
  format: TTSPcmFormat;
}

// TTS player (plays audio in the browser)
export interface TTSPlayer {
  /**
   * Explicit playback mode for the manager. Prefer setting this on concrete
   * players instead of relying on constructor-name inference.
   */
  readonly playbackMode?: TTSPlaybackMode;
  /**
   * MIME type used when the manager turns generated audio into a Blob.
   */
  readonly audioMimeType?: string;
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  /**
   * Stateless audio generation. The `"audio"` playback mode requires this or
   * `generateAudioStream`: the manager plays the finished buffer through an
   * audio element it creates itself, so it can analyze playback for lip-sync.
   * Players that can only `speak()` must use `"web-speech"` mode.
   */
  generateAudio?(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  /**
   * Streaming counterpart to `generateAudio`, for players that can deliver PCM
   * as it is synthesized instead of one finished buffer; the manager schedules
   * it into Web Audio as it arrives. Takes precedence: the manager streams
   * whenever this method exists, so a player implementing both never has
   * `generateAudio` called. Aborting `signal`, or cancelling the returned
   * stream's `body`, must cancel the upstream request.
   */
  generateAudioStream?(
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ): Promise<TTSPcmStream>;
}

// TTS provider (generates audio data)
export interface TTSProvider {
  generateSpeech(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
  setVoice(voice: string): void;
  /** Streaming counterpart to `generateSpeech`, called by a route handler (or a player delegating to it); `generateSpeech` remains for callers that want a whole buffer. Aborting `signal`, or cancelling the returned stream's `body`, must cancel the upstream request. */
  generateSpeechStream?(
    text: string,
    options?: TTSOptions,
    signal?: AbortSignal,
  ): Promise<TTSPcmStream>;
}

// TTS Manager - interface responsible for managing the state of a TTS session
export interface TTSManager {
  speak(text: string, options?: TTSOptions): Promise<void>;
  stop(): Promise<void>;
  setVoice(voice: string): void;
  isSupported(): boolean;
  /**
   * Creates the audio analysis context up front, and, for a player that
   * streams, warms the streamed playback context too; call from a user
   * gesture handler so browsers allow playback later. On a browser without
   * sticky activation (e.g. Safari), skipping this before a streaming
   * `speak()` fails that call with `CharivoStateError` rather than merely
   * degrading lip-sync.
   */
  prepareAudio?(): Promise<void>;
  /**
   * A manager that takes an emitter emits `tts:audio:start` when audio
   * begins. `perform()` reads it to report `heardText`: a cancelled line
   * reports `""` only while no audio start has been heard, and a manager
   * without this method never yields `""` once it was asked to speak.
   */
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
  /** Final resource release; call stop() first - dispose() does not stop playback. */
  dispose?(): Promise<void>;
}

/**
 * `TTSManager` with the members the built-in manager always provides required
 * instead of optional. A third-party `TTSManager` may omit audio preparation,
 * event wiring, or disposal; the manager returned by `createTTSManager` never
 * does, so callers of the factory should not have to narrow them.
 */
export interface BuiltInTTSManager extends TTSManager {
  prepareAudio(): Promise<void>;
  setEventEmitter(eventEmitter: CharivoEventEmitter): void;
  dispose(): Promise<void>;
}

export interface STTOptions {
  language?: string;
}

// STT provider (converts audio data to text)
export interface STTProvider {
  transcribe(audio: Blob | ArrayBuffer, options?: STTOptions): Promise<string>;
}

// STT transcriber (browser-side audio transcription)
// Each transcriber handles recording internally
export interface STTTranscriber {
  startRecording(options?: STTOptions): Promise<void>;
  stopRecording(): Promise<string>;
  isRecording(): boolean;
  /** Optional: subscribe to cumulative interim transcript snapshots (streaming transcribers only). */
  onPartial?(callback: (transcription: string) => void): void;
}

// STT Manager - Manages STT session state
export interface STTManager {
  start(options?: STTOptions): Promise<void>;
  stop(): Promise<string>;
  isRecording(): boolean;
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

/**
 * `STTManager` with event wiring required instead of optional — the manager
 * returned by `createSTTManager` always provides it.
 */
export interface BuiltInSTTManager extends STTManager {
  setEventEmitter(eventEmitter: CharivoEventEmitter): void;
}

// Realtime Manager - Manages Realtime API session state
export interface RealtimeManager {
  setCharacter(character: Character): void;
  getState(): RealtimeState;
  prepareAudio?(config?: RealtimeSessionConfig): Promise<void>;
  startSession(config?: RealtimeSessionConfig): Promise<void>;
  updateSession(config?: RealtimeSessionConfig): Promise<void>;
  stopSession(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendAudioChunk(audio: ArrayBuffer): Promise<void>;
  interrupt(): Promise<void>;
  registerTool(tool: ToolRegistration): void;
  unregisterTool(name: string): void;
  getRegisteredTools(): ToolDefinition[];
  setEventEmitter?(eventEmitter: CharivoEventEmitter): void;
}

/**
 * `RealtimeManager` with the members the built-in manager always provides
 * required instead of optional — `createRealtimeManager` implements both.
 */
export interface BuiltInRealtimeManager extends RealtimeManager {
  prepareAudio(config?: RealtimeSessionConfig): Promise<void>;
  setEventEmitter(eventEmitter: CharivoEventEmitter): void;
}

/**
 * An interface (not a type alias) so third-party packages can extend it via
 * declaration merging — a custom renderer or manager declares its own events
 * without a core change:
 *
 * ```ts
 * import "@charivo/core";
 *
 * declare module "@charivo/core" {
 *   interface EventMap {
 *     "vrm:blendshape": { name: string; weight: number };
 *   }
 * }
 * ```
 *
 * The `import` line matters: it makes the declaring file a module, so
 * `declare module` *augments* the package. In a plain script or `.d.ts` with
 * no top-level import/export, the same block *shadows* `@charivo/core`
 * entirely and every other export vanishes from the compiler's view.
 */
export interface EventMap {
  "message:sent": { message: Message };
  "message:received": { message: Message };
  /**
   * A turn settled `cancelled`: a newer input superseded it, or `turn.cancel()`
   * or the brain's `interrupt()` cut it off. Emitted exactly once for every
   * turn that settles cancelled, on the cascade path only; the realtime path
   * keeps its own contract and never emits this. `turnId` is the id of the turn's
   * input message, and the `message:sent` carrying that id always precedes
   * this event.
   */
  "turn:cancelled": { turnId: string };
  "tts:audio:start": { characterId?: string };
  "tts:audio:end": { characterId?: string };
  "tts:lipsync:update": { rms: number; characterId?: string };
  "stt:start": { options?: STTOptions };
  "stt:partial": { text: string };
  "stt:stop": { text: string };
  "stt:error": { error: Error };
  // Emitted by both the LLM and realtime tool paths.
  "tool:call": {
    name: string;
    args: Record<string, unknown>;
    callId?: string;
  };
  "tool:result": {
    name: string;
    output: Record<string, unknown>;
    callId?: string;
  };
  "tool:error": {
    name: string;
    error: Error;
    callId?: string;
  };
  "realtime:session:start": {
    state: RealtimeState;
    reason?: RealtimeSessionTransitionReason;
  };
  "realtime:session:end": {
    state: RealtimeState;
    reason?: RealtimeSessionTransitionReason;
  };
  "realtime:state": { state: RealtimeState };
  "realtime:user:transcript": { text: string };
  "realtime:assistant:start": { state: RealtimeState };
  "realtime:assistant:delta": { text: string };
  "realtime:assistant:done": { text: string };
  "realtime:reconnect:attempt": {
    attempt: number;
    delayMs: number;
    cause: RealtimeReconnectCause;
  };
  "realtime:reconnect:success": {
    attempts: number;
    totalMs: number;
    cause: RealtimeReconnectCause;
  };
  "realtime:reconnect:exhausted": {
    attempts: number;
    totalMs: number;
    cause: RealtimeReconnectCause;
    lastError: Error;
  };
  // Intentionally flat payload (no wrapper object).
  "realtime:usage": RealtimeUsageEvent;
  /**
   * A held expression claim. The claim fields are optional: with none, the
   * claim comes from source `"app"` at `"explicit"` priority and is bound to
   * the speech in progress or about to start.
   */
  "avatar:expression": { expressionId: string } & AvatarClaimOptions;
  /**
   * A one-shot motion: it is never held or released, so it carries a priority
   * but no source or hold.
   *
   * `muteSound` is a rendering request — play the motion without its baked-in
   * sample clip — not a provenance tag. Absent means audible, so every existing
   * emitter keeps today's behavior.
   */
  "avatar:motion": {
    group: string;
    index: number;
    muteSound?: boolean;
    priority?: AvatarClaimPriority;
  };
  // Intentionally flat payload (no wrapper object).
  "avatar:gaze": GazeCoordinates & AvatarClaimOptions;
  /**
   * Ends `source`'s live claim on `channel`, or on both expression and gaze
   * when `channel` is omitted. Consumed by `RenderManager`. With `claimId`, a
   * claim ends only when it carries the same id, so a stale release never
   * clears a newer claim from the same source.
   */
  "avatar:release": {
    source: string;
    channel?: "expression" | "gaze";
    claimId?: string;
  };
  /**
   * A performance (one line of speech or a silent act) began. `RenderManager`
   * consumes the pair to scope holds: a `voiced` performance is a speech span
   * that binds expression claims without an explicit hold, and a
   * `{ performance: id }` hold follows `performanceId` either way. `perform()`
   * emits it once it holds the floor, after `floor:changed`; the affect
   * events, the render and the speech follow, and exactly one
   * `performance:end` closes it. Speech not reported this way still counts as
   * one span from `tts:audio:start` to `tts:audio:end`. An app running its
   * own speech pipeline may emit the pair itself.
   */
  "performance:start": {
    performanceId: string;
    origin: string;
    /**
     * A speech span. `perform()` sets it when a TTS manager was attached
     * when it took the floor.
     */
    voiced: boolean;
    /** The line, for a string request only. */
    text?: string;
    /** True when the request's affect resolved to an expression id or a motion. */
    affectResolved?: boolean;
  };
  /**
   * One segment of a streamed performance, announced as it is handed to
   * speech and rendered as its own message (id `<performanceId>:<index>`).
   * `index` counts the performance's segments from 0.
   */
  "performance:segment": {
    performanceId: string;
    origin: string;
    index: number;
    text: string;
  };
  /**
   * The performance `performanceId` ended. Releases the claims bound to it,
   * whether or not its `performance:start` was seen.
   */
  "performance:end": {
    performanceId: string;
    origin: string;
    status: PerformanceStatus;
    /** As in {@link PerformanceResult}. */
    heardText?: string;
    error?: CharivoError;
  };
  /** The value of `getFloor()` changed. */
  "floor:changed": { floor: FloorState };
  "realtime:error": { error: Error };
  "llm:error": { error: Error };
}

export interface CharivoEventEmitter {
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;
}

export interface CharivoEventBus extends CharivoEventEmitter {
  on<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
  off<K extends keyof EventMap>(
    event: K,
    listener: (data: EventMap[K]) => void,
  ): void;
}
