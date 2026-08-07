import type {
  Character,
  EventMap,
  RealtimeState,
  ToolRegistration,
  ToolResultProjector,
} from "@charivo/core";
import {
  assertToolResultObject,
  createToolFailureOutput,
  serializeToolResult,
  withToolTimeout,
} from "@charivo/core";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import { validateToolArguments } from "./tool-args-validation";

const TOOL_LABEL = "Realtime tool";

type ToolCallEvent = Extract<RealtimeTransportEvent, { type: "tool.call" }>;

type EmitEvent = <K extends keyof EventMap>(
  event: K,
  payload: EventMap[K],
) => void;

type ToolLog = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
) => void;

export interface ExecuteRealtimeToolCallOptions {
  event: ToolCallEvent;
  tool?: ToolRegistration;
  client: RealtimeTransportClient;
  character: Character | null;
  state: RealtimeState;
  defaultToolTimeoutMs: number;
  resultProjectors?: ToolResultProjector[];
  emit: EmitEvent;
  log: ToolLog;
}

export async function executeRealtimeToolCall({
  event,
  tool,
  client,
  character,
  state,
  defaultToolTimeoutMs,
  resultProjectors,
  emit,
  log,
}: ExecuteRealtimeToolCallOptions): Promise<void> {
  if (!event.callId) {
    emitToolError(
      event.name,
      new Error(`Tool "${event.name}" is missing a call ID`),
      event.callId,
      emit,
      log,
    );
    return;
  }

  if (!tool) {
    await handleToolExecutionFailure(
      event.name,
      event.callId,
      new Error(`No realtime tool registered for "${event.name}"`),
      client,
      emit,
      log,
    );
    return;
  }

  try {
    log("debug", "Realtime tool execution started", {
      name: event.name,
      callId: event.callId,
    });
    const output = await runToolHandler({
      tool,
      event,
      character,
      state,
      defaultToolTimeoutMs,
    });
    await client.sendToolResult(event.callId, output);
    emit("realtime:tool:result", {
      name: event.name,
      output,
      callId: event.callId,
    });
    projectToolResult(
      event.name,
      output,
      resultProjectors,
      emit,
      log,
      event.callId,
    );
    log("info", "Realtime tool execution succeeded", {
      name: event.name,
      callId: event.callId,
    });
  } catch (error) {
    await handleToolExecutionFailure(
      event.name,
      event.callId,
      error instanceof Error ? error : new Error(String(error)),
      client,
      emit,
      log,
    );
  }
}

async function runToolHandler({
  tool,
  event,
  character,
  state,
  defaultToolTimeoutMs,
}: {
  tool: ToolRegistration;
  event: ToolCallEvent;
  character: Character | null;
  state: RealtimeState;
  defaultToolTimeoutMs: number;
}): Promise<Record<string, unknown>> {
  validateToolArguments(tool.definition, event.args);

  const result = await withToolTimeout(
    tool.handler(event.args, {
      character,
      state,
      callId: event.callId,
    }),
    tool.timeoutMs ?? defaultToolTimeoutMs,
    tool.definition.name,
    TOOL_LABEL,
  );

  assertToolResultObject(result, tool.definition.name, TOOL_LABEL);

  // Serialize once inside the failure boundary and hand the parsed snapshot
  // downstream. Transports stringify the output themselves, so returning the
  // live result would let a stateful `toJSON()` (or getter) pass this check and
  // then yield something else — or `undefined` — at the transport boundary,
  // silently dropping the wire `output`. The snapshot is exactly what the wire
  // carries, and a result that cannot be represented as JSON throws here into
  // the caller's failure path instead.
  const snapshot: unknown = JSON.parse(
    serializeToolResult(result, tool.definition.name, TOOL_LABEL),
  );

  // The assert above covers what the handler returned; `toJSON()` can still
  // turn that into null, an array, or a primitive, so the snapshot that
  // actually reaches the transport, the event, and the projectors is checked
  // against the same contract rather than cast to it.
  assertToolResultObject(snapshot, tool.definition.name, TOOL_LABEL);

  return snapshot;
}

async function handleToolExecutionFailure(
  name: string,
  callId: string,
  error: Error,
  client: RealtimeTransportClient,
  emit: EmitEvent,
  log: ToolLog,
): Promise<void> {
  emitToolError(name, error, callId, emit, log);

  try {
    await client.sendToolResult(callId, createToolFailureOutput(error));
  } catch (sendError) {
    emitToolError(
      name,
      sendError instanceof Error ? sendError : new Error(String(sendError)),
      callId,
      emit,
      log,
    );
  }
}

function projectToolResult(
  name: string,
  output: Record<string, unknown>,
  resultProjectors: ToolResultProjector[] | undefined,
  emit: EmitEvent,
  log: ToolLog,
  callId?: string,
): void {
  for (const projector of resultProjectors ?? []) {
    try {
      projector({
        name,
        output,
        callId,
        emit,
      });
    } catch (error) {
      const projectorError =
        error instanceof Error ? error : new Error(String(error));
      log("warn", "Realtime result projector failed", {
        name,
        callId,
        error: projectorError.message,
      });
    }
  }
}

function emitToolError(
  name: string,
  error: Error,
  callId: string | undefined,
  emit: EmitEvent,
  log: ToolLog,
): void {
  log("warn", "Realtime tool execution failed", {
    name,
    callId,
    error: error.message,
  });
  emit("realtime:tool:error", {
    name,
    error,
    callId,
  });
}
