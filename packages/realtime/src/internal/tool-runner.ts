import type {
  Character,
  EventMap,
  RealtimeState,
  RealtimeToolRegistration,
} from "@charivo/core";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import { isRecord } from "./shared";
import { validateToolArguments } from "./tool-args-validation";
import { createFailureOutput, withTimeout } from "./tool-execution";

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

export interface RealtimeToolResultProjectorContext {
  name: string;
  output: Record<string, unknown>;
  callId?: string;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}

export type RealtimeToolResultProjector = (
  context: RealtimeToolResultProjectorContext,
) => void;

export interface ExecuteRealtimeToolCallOptions {
  event: ToolCallEvent;
  tool?: RealtimeToolRegistration;
  client: RealtimeTransportClient;
  character: Character | null;
  state: RealtimeState;
  defaultToolTimeoutMs: number;
  resultProjectors?: RealtimeToolResultProjector[];
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
  tool: RealtimeToolRegistration;
  event: ToolCallEvent;
  character: Character | null;
  state: RealtimeState;
  defaultToolTimeoutMs: number;
}): Promise<Record<string, unknown>> {
  validateToolArguments(tool.definition, event.args);

  const result = await withTimeout(
    tool.handler(event.args, {
      character,
      state,
      callId: event.callId,
    }),
    tool.timeoutMs ?? defaultToolTimeoutMs,
    tool.definition.name,
  );

  if (!isRecord(result)) {
    throw new Error(
      `Realtime tool "${tool.definition.name}" must return an object`,
    );
  }

  return result;
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
    await client.sendToolResult(callId, createFailureOutput(error));
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
  resultProjectors: RealtimeToolResultProjector[] | undefined,
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
