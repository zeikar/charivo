import { vi } from "vitest";
import { createCharivo, type Charivo } from "@charivo/core";
import type {
  Character,
  CharivoEventBus,
  CharivoEventEmitter,
  ConversationBrain,
  GazeCoordinates,
  GenerateResponseOptions,
  HistoryRollback,
  LLMClient,
  LLMManager,
  LLMMessage,
  Message,
  RenderManager,
  TTSManager,
  TTSOptions,
} from "@charivo/core";
import {
  createCascadeBrain,
  createLLMManager,
  type CascadeBrainOptions,
} from "@charivo/llm";

// ---------------------------------------------------------------------------
// Cascade brain turns: gates for every phase of a turn.
//
// Everything below is settled by hand -- no timers, no elapsed-time
// assumptions. A stub parks the turn wherever the test needs it and the test
// releases it explicitly, so the interleavings under test are exact.
// ---------------------------------------------------------------------------

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Releases waiters the moment their condition holds. */
export class Waiters {
  private readonly pending: Array<{
    ready: () => boolean;
    resolve: () => void;
  }> = [];

  until(ready: () => boolean): Promise<void> {
    if (ready()) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.pending.push({ ready, resolve });
    });
  }

  notify(): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const waiter = this.pending[index]!;
      if (waiter.ready()) {
        this.pending.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

/** Ordered string log a test can await by length. */
export class EventLog {
  readonly entries: string[] = [];
  private readonly waiters = new Waiters();

  push(entry: string): void {
    this.entries.push(entry);
    this.waiters.notify();
  }

  until(length: number): Promise<void> {
    return this.waiters.until(() => this.entries.length >= length);
  }
}

export class GateableRenderManager implements RenderManager {
  initialize = vi.fn(async () => undefined);
  destroy = vi.fn(async () => undefined);
  setCharacter = vi.fn((_character: Character) => undefined);
  setLocalGaze = vi.fn((_coords: GazeCoordinates) => false);
  setEventBus = vi.fn((_eventBus: CharivoEventBus) => undefined);
  disconnect = vi.fn(() => undefined);
  loadModel = vi.fn(async (_modelPath: string) => undefined);
  setMessageCallback = vi.fn(
    (_callback: (message: Message, character?: Character) => void) => undefined,
  );

  /** Renders whose message matches stay pending until settled explicitly. */
  hold: (message: Message) => boolean = () => false;
  readonly calls: Array<{
    message: Message;
    character?: Character;
    gate?: Deferred<void>;
  }> = [];
  private readonly waiters = new Waiters();

  render = vi.fn(async (message: Message, character?: Character) => {
    const call: {
      message: Message;
      character?: Character;
      gate?: Deferred<void>;
    } = { message, character };

    if (this.hold(message)) {
      call.gate = createDeferred<void>();
    }

    this.calls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  rendered(): string[] {
    return this.calls.map((call) => describeMessage(call.message));
  }

  waitForCalls(count: number): Promise<void> {
    return this.waiters.until(() => this.calls.length >= count);
  }

  settle(match: (message: Message) => boolean = () => true): void {
    for (const call of this.calls) {
      if (call.gate && match(call.message)) {
        call.gate.resolve();
      }
    }
  }

  fail(error: Error, match: (message: Message) => boolean = () => true): void {
    for (const call of this.calls) {
      if (call.gate && match(call.message)) {
        call.gate.reject(error);
      }
    }
  }
}

export class GateableTTSManager implements TTSManager {
  /** Which stop()/speak() calls park until settled explicitly. */
  holdStop: (callIndex: number) => boolean = () => false;
  holdSpeak: (text: string) => boolean = () => false;
  /** Runs as speak() is called, before anything else it does. */
  onSpeak: (text: string) => void = () => undefined;
  readonly stopCalls: Array<{ gate?: Deferred<void> }> = [];
  readonly speakCalls: Array<{
    text: string;
    options?: TTSOptions;
    gate?: Deferred<void>;
  }> = [];
  private readonly waiters = new Waiters();

  stop = vi.fn(async () => {
    const call: { gate?: Deferred<void> } = {};

    if (this.holdStop(this.stopCalls.length)) {
      call.gate = createDeferred<void>();
    }

    this.stopCalls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  speak = vi.fn(async (text: string, options?: TTSOptions) => {
    this.onSpeak(text);
    const call: {
      text: string;
      options?: TTSOptions;
      gate?: Deferred<void>;
    } = { text, options };

    if (this.holdSpeak(text)) {
      call.gate = createDeferred<void>();
    }

    this.speakCalls.push(call);
    this.waiters.notify();

    if (call.gate) {
      await call.gate.promise;
    }
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);

  spokenTexts(): string[] {
    return this.speakCalls.map((call) => call.text);
  }

  waitForStops(count: number): Promise<void> {
    return this.waiters.until(() => this.stopCalls.length >= count);
  }

  waitForSpeaks(count: number): Promise<void> {
    return this.waiters.until(() => this.speakCalls.length >= count);
  }

  settleStop(index: number): void {
    this.stopCalls[index]?.gate?.resolve();
  }

  failStop(index: number, error: Error): void {
    this.stopCalls[index]?.gate?.reject(error);
  }

  settleSpeak(match: (text: string) => boolean): void {
    for (const call of this.speakCalls) {
      if (call.gate && match(call.text)) {
        call.gate.resolve();
      }
    }
  }

  failSpeak(match: (text: string) => boolean, error: Error): void {
    for (const call of this.speakCalls) {
      if (call.gate && match(call.text)) {
        call.gate.reject(error);
      }
    }
  }
}

export class GateableLLMClient implements LLMClient {
  /**
   * Reply text to answer with immediately, or null to park the call until the
   * test settles it. Throwing makes the call reject.
   */
  responder: (lastContent: string) => string | null = (content) =>
    `reply-${content}`;
  readonly prompts: Array<LLMMessage[]> = [];
  private readonly gates: Array<Deferred<string> | undefined> = [];
  private readonly waiters = new Waiters();

  call = vi.fn(async (messages: LLMMessage[]) => {
    this.prompts.push(messages);
    const immediate = this.responder(lastContentOf(messages));

    if (immediate !== null) {
      this.gates.push(undefined);
      this.waiters.notify();
      return immediate;
    }

    const gate = createDeferred<string>();
    this.gates.push(gate);
    this.waiters.notify();
    return gate.promise;
  });

  waitForCalls(count: number): Promise<void> {
    return this.waiters.until(() => this.prompts.length >= count);
  }

  /** True when some prompt was built for a turn whose newest message is `content`. */
  calledFor(content: string): boolean {
    return this.prompts.some((prompt) => lastContentOf(prompt) === content);
  }

  promptFor(content: string): LLMMessage[] {
    const prompt = this.prompts.find(
      (candidate) => lastContentOf(candidate) === content,
    );

    if (!prompt) {
      throw new Error(`No LLM prompt was built for "${content}"`);
    }

    return prompt;
  }

  resolveCall(content: string, reply: string): void {
    this.pendingGate(content).resolve(reply);
  }

  rejectCall(content: string, error: Error): void {
    this.pendingGate(content).reject(error);
  }

  private pendingGate(content: string): Deferred<string> {
    const index = this.prompts.findIndex(
      (prompt, position) =>
        this.gates[position] !== undefined && lastContentOf(prompt) === content,
    );

    if (index === -1) {
      throw new Error(`No pending LLM call for "${content}"`);
    }

    return this.gates[index]!;
  }
}

/**
 * Custom LLMManager stub: only a manager can call back into Charivo, so the
 * reentrancy tests need one. It records the order of its addToHistory
 * arguments, which is the Charivo-side write ordering under test.
 */
export class RecordingLLMManager implements LLMManager {
  readonly added: Message[] = [];
  readonly generated: Message[] = [];
  /** Runs inside addToHistory -- the one place a manager can reenter Charivo. */
  onAdd: (message: Message) => void = () => undefined;
  onGenerate: (message: Message) => void = () => undefined;
  emitter?: CharivoEventEmitter;

  setCharacter = vi.fn((_character: Character) => undefined);
  getCharacter = vi.fn((): Character | null => null);
  clearHistory = vi.fn(() => undefined);
  getHistory = vi.fn((): Message[] => []);
  addToHistory = vi.fn((message: Message): HistoryRollback => {
    this.added.push(message);
    this.onAdd(message);
    return () => undefined;
  });
  generateResponse = vi.fn(
    async (message: Message, _options?: GenerateResponseOptions) => {
      this.generated.push(message);
      this.onGenerate(message);
      return `reply-${message.content}`;
    },
  );
  setEventEmitter = vi.fn((eventEmitter: CharivoEventEmitter) => {
    this.emitter = eventEmitter;
  });

  addedContents(): string[] {
    return this.added.map((message) => message.content);
  }

  generatedContents(): string[] {
    return this.generated.map((message) => message.content);
  }
}

/**
 * Records the signal each turn hands to generateResponse, and parks the calls
 * it is told to hold, so a supersession can be observed against a request that
 * is still in flight. Also records its writes, since the transport half of a
 * cancellation has to leave history ordering alone.
 */
export class SignalRecordingLLMManager implements LLMManager {
  /** Contents whose generateResponse parks until settled explicitly. */
  hold: (content: string) => boolean = () => false;
  readonly added: Message[] = [];
  readonly calls: Array<{
    content: string;
    signal?: AbortSignal;
    gate?: Deferred<string>;
  }> = [];
  private readonly waiters = new Waiters();

  setCharacter = vi.fn((_character: Character) => undefined);
  getCharacter = vi.fn((): Character | null => null);
  clearHistory = vi.fn(() => undefined);
  getHistory = vi.fn((): Message[] => []);
  addToHistory = vi.fn((message: Message): HistoryRollback => {
    this.added.push(message);
    return () => undefined;
  });
  generateResponse = vi.fn(
    async (message: Message, options?: GenerateResponseOptions) => {
      const call: {
        content: string;
        signal?: AbortSignal;
        gate?: Deferred<string>;
      } = { content: message.content, signal: options?.signal };

      if (this.hold(message.content)) {
        call.gate = createDeferred<string>();
      }

      this.calls.push(call);
      this.waiters.notify();

      return call.gate ? call.gate.promise : `reply-${message.content}`;
    },
  );
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);

  addedContents(): string[] {
    return this.added.map((message) => message.content);
  }

  waitForCalls(count: number): Promise<void> {
    return this.waiters.until(() => this.calls.length >= count);
  }

  signalFor(content: string): AbortSignal | undefined {
    return this.callFor(content).signal;
  }

  settleCall(content: string, reply: string): void {
    this.pendingGate(content).resolve(reply);
  }

  rejectCall(content: string, reason: unknown): void {
    this.pendingGate(content).reject(reason);
  }

  private callFor(content: string): {
    content: string;
    signal?: AbortSignal;
    gate?: Deferred<string>;
  } {
    const call = this.calls.find((candidate) => candidate.content === content);

    if (!call) {
      throw new Error(`No generateResponse call for "${content}"`);
    }

    return call;
  }

  private pendingGate(content: string): Deferred<string> {
    const gate = this.callFor(content).gate;

    if (!gate) {
      throw new Error(`No pending generateResponse call for "${content}"`);
    }

    return gate;
  }
}

/**
 * ControllableTTSManager's session semantics plus a label, so a test running
 * two managers can tell whose audio events these are. Audio events go into a
 * shared log instead of the bus, which keeps them orderable against bus
 * events without changing any payload shape.
 */
export class LabeledTTSManager implements TTSManager {
  private sessionSeq = 0;
  private activeSession: number | null = null;
  private readonly gates = new Map<number, () => void>();

  constructor(
    private readonly label: string,
    private readonly log: EventLog,
  ) {}

  speak = vi.fn(async (_text: string, _options?: TTSOptions) => {
    await this.stop();

    const session = ++this.sessionSeq;
    this.activeSession = session;
    this.log.push(`audio:start(${this.label})`);

    await new Promise<void>((resolve) => this.gates.set(session, resolve));

    if (this.gates.delete(session)) {
      this.activeSession = null;
      this.log.push(`audio:end(${this.label})`);
    }
  });

  stop = vi.fn(async () => {
    if (this.activeSession === null) return;

    const session = this.activeSession;
    this.activeSession = null;
    this.log.push(`audio:end(${this.label})`);

    const resolveGate = this.gates.get(session);
    if (resolveGate) {
      this.gates.delete(session);
      resolveGate();
    }
  });

  setVoice = vi.fn((_voice: string) => undefined);
  isSupported = vi.fn(() => true);
  setEventEmitter = vi.fn((_eventEmitter: CharivoEventEmitter) => undefined);

  getActiveSession(): number | null {
    return this.activeSession;
  }

  finishUtterance(session: number): void {
    this.gates.get(session)?.();
  }
}

/**
 * Records the turn lifecycle in emission order and maps message ids back to
 * the text their turn started with, so assertions can name turns by content.
 * The harness constructs it before any test listener is added, so it observes
 * each event ahead of them.
 */
export class TurnRecorder {
  readonly log: string[] = [];
  private readonly contentById = new Map<string, string>();

  constructor(charivo: Charivo) {
    charivo.on("message:sent", ({ message }) => {
      this.contentById.set(message.id, message.content);
      this.log.push(`sent:${message.content}`);
    });
    charivo.on("message:received", ({ message }) => {
      this.log.push(`received:${message.content}`);
    });
    charivo.on("turn:cancelled", ({ turnId }) => {
      this.log.push(
        `cancelled:${this.contentById.get(turnId) ?? `<unknown ${turnId}>`}`,
      );
    });
    charivo.on("performance:start", ({ origin, text }) => {
      this.log.push(`start:${origin}:${text ?? "<stream>"}`);
    });
    charivo.on("performance:end", ({ origin, status }) => {
      this.log.push(`end:${origin}:${status}`);
    });
  }

  get sent(): string[] {
    return this.entriesOf("sent:");
  }

  get cancelled(): string[] {
    return this.entriesOf("cancelled:");
  }

  private entriesOf(prefix: string): string[] {
    return this.log
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length));
  }
}

export function lastContentOf(messages: Array<{ content: string }>): string {
  return messages[messages.length - 1]?.content ?? "";
}

export function describeMessage(message: Message): string {
  return `${message.type}:${message.content}`;
}

/** History as `type:content` pairs, so contents are compared, not just shape. */
export function transcript(messages: Message[]): string[] {
  return messages.map(describeMessage);
}

let seededMessages = 0;
export function buildMessage(content: string, type: Message["type"]): Message {
  seededMessages += 1;
  return {
    id: `seed-${seededMessages}`,
    content,
    timestamp: new Date(),
    type,
  };
}

export const character: Character = {
  id: "char-1",
  name: "Hiyori",
  description: "A cheerful assistant",
  personality: "Always upbeat",
  voice: { voiceId: "alloy", rate: 1.5, pitch: 1.2, volume: 0.8 },
};

export interface Harness {
  charivo: Charivo;
  brain: ConversationBrain;
  render: GateableRenderManager;
  tts: GateableTTSManager;
  client: GateableLLMClient;
  manager: LLMManager;
  recorder: TurnRecorder;
}

export interface HarnessOptions {
  renderer?: boolean;
  tts?: boolean;
  maxHistoryTurns?: number;
  /** A manager of the test's own; `client` then goes unused. */
  manager?: LLMManager;
  review?: CascadeBrainOptions["review"];
}

/**
 * `createCharivo({ brain: createCascadeBrain(llm, { review }), renderer, tts, character })`
 * with the gateable stubs. The recorder is subscribed before any turn runs.
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const { renderer = true, tts = false, maxHistoryTurns } = options;
  const render = new GateableRenderManager();
  const ttsManager = new GateableTTSManager();
  const client = new GateableLLMClient();
  const manager =
    options.manager ??
    createLLMManager(
      client,
      maxHistoryTurns === undefined ? undefined : { maxHistoryTurns },
    );
  const brain = createCascadeBrain(manager, { review: options.review });
  const charivo = createCharivo({
    brain,
    renderer: renderer ? render : null,
    tts: tts ? ttsManager : null,
    character,
  });
  const recorder = new TurnRecorder(charivo);

  return {
    charivo,
    brain,
    render,
    tts: ttsManager,
    client,
    manager,
    recorder,
  };
}
