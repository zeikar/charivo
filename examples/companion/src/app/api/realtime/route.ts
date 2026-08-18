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
  REALTIME_TOOL_CHOICES,
  REALTIME_TRANSCRIPTION_MODEL,
} from "../demo-limits";

/**
 * Rebuild the session from scratch instead of forwarding the client's copy.
 * `RealtimeSessionConfig` carries `model` and `instructions`, so passing the
 * request body through would let any caller point this key at any model with
 * their own system prompt — a general-purpose LLM proxy on someone else's bill.
 * Only the fields the demo genuinely needs from the browser survive, and each
 * one is bounded.
 *
 * `voice` is not among them: the companion never sends one, so the provider
 * default applies. Wiring a character's voice into the realtime path means
 * adding it here behind an allowlist, the way `examples/web` does.
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
    // UTF-8 bytes, not `.length` — a non-ASCII schema is bigger on the wire
    // than its UTF-16 code-unit count suggests.
    if (
      new TextEncoder().encode(JSON.stringify(tools)).length >
      REALTIME_MAX_TOOLS_BYTES
    ) {
      return {
        ok: false,
        error: `session.tools exceeds ${REALTIME_MAX_TOOLS_BYTES} bytes`,
      };
    }
  }

  const toolChoice = requested.toolChoice;
  if (
    toolChoice !== undefined &&
    !REALTIME_TOOL_CHOICES.includes(
      toolChoice as (typeof REALTIME_TOOL_CHOICES)[number],
    )
  ) {
    return {
      ok: false,
      error: `session.toolChoice must be one of ${REALTIME_TOOL_CHOICES.join(", ")}`,
    };
  }

  return {
    ok: true,
    value: {
      provider: "openai",
      model: REALTIME_MODEL,
      maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(toolChoice !== undefined ? { toolChoice } : {}),
      // Asking for transcription at all gets transcription: `enabled: false`
      // outranks `model` downstream (`packages/server/src/openai/realtime`
      // sends `transcription: null` for it), so forwarding the caller's flag
      // would let a request switch off the very thing that makes user turns
      // observable — and therefore what the memory write path records. The
      // model is the route's choice too, not the caller's.
      ...(requested.inputAudioTranscription
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
