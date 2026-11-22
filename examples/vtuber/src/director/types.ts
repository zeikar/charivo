// The Director's contracts. This module stays portable: it imports nothing
// outside src/director/, so the character and the inputs reach it only
// through CharacterPort and ShowEventSource, both defined here.

export type AgentPriority = "low" | "normal" | "high";

export interface ChatEvent {
  kind: "chat";
  viewer: string;
  text: string;
  highlighted?: boolean;
}

export interface AgentEvent {
  kind: "agent";
  /** The emitting agent's name. A free string; no name is special-cased. */
  source: string;
  text: string;
  priority: AgentPriority;
}

/** The idle timer fired. */
export interface IdleEvent {
  kind: "idle";
}

/** The segment scheduler reached the start of `plan.segments[index]`. */
export interface SegmentEvent {
  kind: "segment";
  index: number;
  segment: Segment;
}

/** What a source outside the Director may emit. */
export type ExternalShowEvent = ChatEvent | AgentEvent;

export type ShowEvent = ExternalShowEvent | IdleEvent | SegmentEvent;

export interface ShowEventSource<E extends ShowEvent = ExternalShowEvent> {
  start(emit: (event: E) => void): void;
  stop(): void;
}

export type LineSource = "chat" | "agent" | "idle" | "segment";

export interface Line {
  id: string;
  source: LineSource;
  /** Higher is spoken first; equal priorities are spoken in arrival order. */
  priority: number;
  /** Already enveloped (see envelope.ts). */
  prompt: string;
  createdAt: number;
  /** Dropped at dequeue once passed. Accepted chat has none: it never expires. */
  expiresAt?: number;
}

export type IgnoreReason =
  | "show-not-running"
  | "empty"
  | "viewer-cooldown"
  | "source-cooldown"
  | "queue-full"
  | "not-silent"
  | "show-ending"
  | "stale";

export type Decision =
  | { kind: "ignore"; reason: IgnoreReason }
  | { kind: "enqueue"; line: Line }
  | { kind: "interrupt"; line: Line };

export type Segment =
  | {
      kind: "opening" | "topic";
      title: string;
      cue: string;
      /** Time from this segment's start to the next segment's start. */
      durationMs: number;
    }
  | {
      // The ending has no duration: the show finishes when its line settles.
      kind: "ending";
      title: string;
      cue: string;
    };

export interface ShowPlan {
  segments: Segment[];
}

export type SpeakResult =
  | { status: "completed" | "cancelled"; text: string }
  | {
      status: "failed";
      text: string;
      /** The failure message, when the port has one. */
      error?: string;
    };

export interface CharacterPort {
  /** Settles when the line is over, however it ended. */
  speak(prompt: string): Promise<SpeakResult>;
  /** Resolves once the audio has stopped; rejects when it could not be stopped. */
  interrupt(): Promise<void>;
}

export interface DirectorConfig {
  idleAfterMs: number;
  /** Least time between two speak() calls. Spaces lines; does not limit requests. */
  minLineIntervalMs: number;
  /** Least time from a failed line's start to the next speak() call. */
  failedLineBackoffMs: number;
  /** Shared by highlighted chat and `high` agent events. */
  interruptCooldownMs: number;
  viewerCooldownMs: number;
  maxPendingChat: number;
  /** Kept per agent `source`. */
  agentCooldownMs: number;
  maxPendingAgent: number;
  agentMaxAgeMs: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  idleAfterMs: 8_000,
  // Pacing is the app's call; the module does not assume a provider.
  minLineIntervalMs: 0,
  failedLineBackoffMs: 0,
  interruptCooldownMs: 15_000,
  viewerCooldownMs: 10_000,
  maxPendingChat: 5,
  agentCooldownMs: 10_000,
  maxPendingAgent: 3,
  agentMaxAgeMs: 30_000,
};

export type DirectorStatus =
  | "ready"
  | "running"
  | "finished"
  | "stopped"
  | "failed";

export type DirectorLogEntry =
  | { kind: "decision"; at: number; event: ShowEvent; decision: Decision }
  | { kind: "line-start"; at: number; line: Line }
  | {
      kind: "line-end";
      at: number;
      line: Line;
      result: SpeakResult;
      /** findCueLeak() on the reply. */
      leak: boolean;
    }
  | { kind: "line-dropped"; at: number; line: Line; reason: "stale" }
  | { kind: "segment"; at: number; index: number; segment: Segment }
  | { kind: "error"; at: number; message: string };

export interface DirectorCounters {
  linesSpoken: number;
  linesCancelled: number;
  linesFailed: number;
  eventsIgnored: number;
  cueLeaks: number;
}

export interface DirectorSnapshot {
  status: DirectorStatus;
  segmentIndex: number | null;
  segment: Segment | null;
  inFlight: Line | null;
  queue: readonly Line[];
  counters: DirectorCounters;
  /** Set when status is `failed`. */
  error: string | null;
}
