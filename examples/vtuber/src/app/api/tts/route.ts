import { NextRequest, NextResponse } from "next/server";
import { createGeminiTTSProvider } from "@charivo/server/gemini";
import {
  TTS_GEMINI_ALLOWED_VOICES,
  TTS_GEMINI_MAX_TEXT_CHARS,
  TTS_GEMINI_MODEL,
  TTS_GEMINI_ROUTE_TIMEOUT_MS,
  TTS_GEMINI_VOICE,
} from "../demo-limits";

function getGeminiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object" },
      { status: 400 },
    );
  }

  const { text, voice = TTS_GEMINI_VOICE } = body as {
    text?: unknown;
    voice?: unknown;
  };

  if (!text || typeof text !== "string") {
    return NextResponse.json(
      { error: "Text is required and must be a string" },
      { status: 400 },
    );
  }

  // Bounded for latency, not cost — see `demo-limits.ts`.
  if (text.length > TTS_GEMINI_MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds ${TTS_GEMINI_MAX_TEXT_CHARS} characters` },
      { status: 400 },
    );
  }

  if (typeof voice !== "string" || !TTS_GEMINI_ALLOWED_VOICES.has(voice)) {
    return NextResponse.json({ error: "Unsupported voice" }, { status: 400 });
  }

  try {
    // The deadline sits under the remote player's fixed 30s, see
    // `demo-limits.ts`. The player is not flagged `streaming`, so this route
    // only ever answers a finished WAV. `rate` is ignored by Gemini TTS and
    // not forwarded.
    const ttsProvider = createGeminiTTSProvider({
      apiKey: getGeminiKey(),
      defaultModel: TTS_GEMINI_MODEL,
      timeoutMs: TTS_GEMINI_ROUTE_TIMEOUT_MS,
    });

    const audioBuffer = await ttsProvider.generateSpeech(text, { voice });

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("Gemini TTS API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
