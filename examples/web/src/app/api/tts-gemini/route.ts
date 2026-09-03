import { NextRequest, NextResponse } from "next/server";
import { createGeminiTTSProvider } from "@charivo/server/gemini";
import {
  TTS_GEMINI_ALLOWED_VOICES,
  TTS_GEMINI_FALLBACK_VOICE,
  TTS_GEMINI_MAX_TEXT_CHARS,
  TTS_GEMINI_MODEL,
  TTS_GEMINI_ROUTE_TIMEOUT_MS,
} from "../demo-limits";

function getGeminiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    // No `defaultVoice`: this route always resolves a voice itself and passes
    // it explicitly, so the provider's own default is never consulted. The
    // deadline sits under the remote player's fixed 30s, see `demo-limits.ts`.
    const ttsProvider = createGeminiTTSProvider({
      apiKey: getGeminiKey(),
      defaultModel: TTS_GEMINI_MODEL,
      timeoutMs: TTS_GEMINI_ROUTE_TIMEOUT_MS,
    });

    const {
      text,
      voice = TTS_GEMINI_FALLBACK_VOICE,
      speed = 1.0,
    } = await request.json();

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

    if (typeof speed !== "number" || !Number.isFinite(speed)) {
      return NextResponse.json(
        { error: "speed must be a finite number" },
        { status: 400 },
      );
    }
    // Not clamped or forwarded: the Gemini TTS provider ignores `rate`.

    // TTS generation
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
