import { NextRequest, NextResponse } from "next/server";
import {
  createOpenAIRealtimeProvider,
  type OpenAIRealtimeProviderConfig,
} from "@charivo/server/openai";
import type {
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  REALTIME_MAX_INSTRUCTIONS_CHARS,
  REALTIME_MAX_OUTPUT_TOKENS,
  REALTIME_MAX_TOOLS,
  REALTIME_MAX_TOOLS_BYTES,
  REALTIME_MODEL,
  REALTIME_TRANSCRIPTION_MODEL,
  TTS_ALLOWED_VOICES,
} from "../demo-limits";

/**
 * Rebuild the session from scratch instead of forwarding the client's copy.
 * `RealtimeSessionConfig` carries `model` and `instructions`, so passing the
 * request body through would let any caller point this key at any model with
 * their own system prompt — a general-purpose LLM proxy on someone else's bill.
 * Only the fields the demo genuinely needs from the browser survive, and each
 * one is bounded.
 */
function buildSessionConfig(
  requested: RealtimeSessionConfig,
): { ok: true; value: RealtimeSessionConfig } | { ok: false; error: string } {
  const instructions = requested.instructions;
  if (instructions !== undefined) {
    if (typeof instructions !== "string") {
      return { ok: false, error: "session.instructions must be a string" };
    }
    if (instructions.length > REALTIME_MAX_INSTRUCTIONS_CHARS) {
      return {
        ok: false,
        error: `session.instructions exceeds ${REALTIME_MAX_INSTRUCTIONS_CHARS} characters`,
      };
    }
  }

  const tools = requested.tools;
  if (tools !== undefined) {
    if (!Array.isArray(tools)) {
      return { ok: false, error: "session.tools must be an array" };
    }
    if (tools.length > REALTIME_MAX_TOOLS) {
      return {
        ok: false,
        error: `session.tools exceeds ${REALTIME_MAX_TOOLS} entries`,
      };
    }
    if (JSON.stringify(tools).length > REALTIME_MAX_TOOLS_BYTES) {
      return {
        ok: false,
        error: `session.tools exceeds ${REALTIME_MAX_TOOLS_BYTES} bytes`,
      };
    }
  }

  // Unknown voices fall back to the provider default rather than erroring:
  // voice costs nothing, so a stale value should not break the demo.
  const voice =
    requested.voice && TTS_ALLOWED_VOICES.has(requested.voice)
      ? requested.voice
      : undefined;

  return {
    ok: true,
    value: {
      provider: "openai",
      model: REALTIME_MODEL,
      maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(requested.toolChoice !== undefined
        ? { toolChoice: requested.toolChoice }
        : {}),
      ...(voice !== undefined ? { voice } : {}),
      ...(requested.inputAudioTranscription?.enabled
        ? {
            inputAudioTranscription: {
              enabled: true,
              model: REALTIME_TRANSCRIPTION_MODEL,
            },
          }
        : {}),
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<RealtimeSessionRequest>;
    if (!body.transport || !body.session) {
      return NextResponse.json(
        { error: "transport and session are required" },
        { status: 400 },
      );
    }

    if (body.session.provider !== "openai") {
      return NextResponse.json(
        {
          error: `Unsupported realtime provider: ${body.session.provider ?? "(unspecified)"}`,
        },
        { status: 501 },
      );
    }

    const session = buildSessionConfig(body.session);
    if (!session.ok) {
      return NextResponse.json({ error: session.error }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const providerConfig: OpenAIRealtimeProviderConfig = {
      apiKey,
    };
    const provider = createOpenAIRealtimeProvider(providerConfig);

    const bootstrap = await provider.createSession({
      adapter: body.adapter,
      transport: body.transport,
      session: session.value,
      sdpOffer: body.sdpOffer,
    });

    return NextResponse.json(bootstrap);
  } catch (error) {
    console.error("Realtime session error:", error);
    return NextResponse.json(
      {
        error: "Failed to create Realtime session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
