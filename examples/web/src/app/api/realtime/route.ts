import { NextRequest, NextResponse } from "next/server";
import {
  createOpenAIRealtimeProvider,
  type OpenAIRealtimeProviderConfig,
} from "@charivo/server/openai";
import { createGeminiRealtimeProvider } from "@charivo/server/gemini";
import {
  GEMINI_LIVE_ADAPTER,
  type RealtimeProvider,
  type RealtimeSessionConfig,
  type RealtimeSessionRequest,
} from "@charivo/core";
import {
  REALTIME_GEMINI_MODEL,
  REALTIME_MAX_INSTRUCTIONS_CHARS,
  REALTIME_MAX_OUTPUT_TOKENS,
  REALTIME_MAX_TOOLS,
  REALTIME_MAX_TOOLS_BYTES,
  REALTIME_OPENAI_MODEL,
  REALTIME_TOOL_CHOICES,
  REALTIME_TRANSCRIPTION_MODEL,
  TTS_ALLOWED_VOICES,
} from "../demo-limits";

type SessionResult =
  | { ok: true; value: RealtimeSessionConfig }
  | { ok: false; error: string };

/**
 * Every provider branch rebuilds the session from scratch instead of forwarding
 * the client's copy. `RealtimeSessionConfig` carries `model` and `instructions`,
 * so passing the request body through would let any caller point a paid key at
 * any model with their own system prompt — a general-purpose LLM proxy on
 * someone else's bill. Only the fields the demo genuinely needs from the browser
 * survive, and each one is bounded; everything else an assembler emits is pinned
 * server-side.
 */
function checkSharedInput(
  requested: RealtimeSessionConfig,
):
  | { ok: true; value: Pick<RealtimeSessionConfig, "instructions" | "tools"> }
  | { ok: false; error: string } {
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

  return { ok: true, value: { instructions, tools } };
}

function buildOpenAISessionConfig(
  requested: RealtimeSessionConfig,
): SessionResult {
  const bounded = checkSharedInput(requested);
  if (!bounded.ok) {
    return bounded;
  }
  const { instructions, tools } = bounded.value;

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
      model: REALTIME_OPENAI_MODEL,
      maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(toolChoice !== undefined ? { toolChoice } : {}),
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

function buildGeminiSessionConfig(
  requested: RealtimeSessionConfig,
): SessionResult {
  const bounded = checkSharedInput(requested);
  if (!bounded.ok) {
    return bounded;
  }
  const { instructions, tools } = bounded.value;

  // `@charivo/server/gemini` refuses "none"/"required" outright — the Live API
  // has no tool-choice equivalent — so catching them here answers a caller
  // mistake with a 400. Letting it reach the provider would answer 500 instead,
  // telling the caller the server broke when their request was wrong. "auto" is
  // the only behavior that provider has, so nothing needs forwarding.
  if (requested.toolChoice !== undefined && requested.toolChoice !== "auto") {
    return {
      ok: false,
      error: 'session.toolChoice must be "auto" for the gemini provider',
    };
  }

  // No `voice`: the shipped characters carry OpenAI voice ids, and
  // `@charivo/server/gemini` picks its own default from Google's list.
  // No `inputAudioTranscription` either: the demo never reads user
  // transcripts, and leaving the block out keeps them off and unbilled.
  return {
    ok: true,
    value: {
      provider: "gemini",
      model: REALTIME_GEMINI_MODEL,
      maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      ...(instructions !== undefined ? { instructions } : {}),
      ...(tools !== undefined ? { tools } : {}),
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

    let provider: RealtimeProvider;
    let session: RealtimeSessionConfig;

    switch (body.session.provider) {
      case "openai": {
        const built = buildOpenAISessionConfig(body.session);
        if (!built.ok) {
          return NextResponse.json({ error: built.error }, { status: 400 });
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
        provider = createOpenAIRealtimeProvider(providerConfig);
        session = built.value;
        break;
      }
      case "gemini": {
        // Gemini Live is websocket-only and speaks one adapter. The provider
        // rejects anything else, but from inside the try that comes back as a
        // 500, telling the caller the server broke when their request was
        // wrong — so a caller mistake is answered here as a 400 instead.
        if (body.transport !== "websocket") {
          return NextResponse.json(
            {
              error: `transport must be "websocket" when session.provider is "gemini", received "${body.transport}"`,
            },
            { status: 400 },
          );
        }
        if (
          body.adapter !== undefined &&
          body.adapter !== GEMINI_LIVE_ADAPTER
        ) {
          return NextResponse.json(
            {
              error: `adapter must be "${GEMINI_LIVE_ADAPTER}" when session.provider is "gemini", received "${body.adapter}"`,
            },
            { status: 400 },
          );
        }

        const built = buildGeminiSessionConfig(body.session);
        if (!built.ok) {
          return NextResponse.json({ error: built.error }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return NextResponse.json(
            { error: "GEMINI_API_KEY not configured" },
            { status: 500 },
          );
        }

        provider = createGeminiRealtimeProvider({ apiKey });
        session = built.value;
        break;
      }
      default:
        return NextResponse.json(
          {
            error: `Unsupported realtime provider: ${body.session.provider ?? "(unspecified)"}`,
          },
          { status: 501 },
        );
    }

    const bootstrap = await provider.createSession({
      adapter: body.adapter,
      transport: body.transport,
      session,
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
