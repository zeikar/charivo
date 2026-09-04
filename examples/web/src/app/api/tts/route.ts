import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSProvider } from "@charivo/server/openai";
import {
  TTS_ALLOWED_VOICES,
  TTS_FALLBACK_VOICE,
  TTS_MAX_TEXT_CHARS,
} from "../demo-limits";

function getOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    // No `defaultVoice`: this route always resolves a voice itself and passes
    // it explicitly, so the provider's own default is never consulted.
    const ttsProvider = createOpenAITTSProvider({
      apiKey: getOpenAIKey(),
      defaultModel: "gpt-4o-mini-tts",
    });

    const {
      text,
      voice = TTS_FALLBACK_VOICE,
      speed = 1.0,
    } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    // TTS bills per input character, so an unbounded string is an unbounded bill.
    if (text.length > TTS_MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Text exceeds ${TTS_MAX_TEXT_CHARS} characters` },
        { status: 400 },
      );
    }

    if (typeof voice !== "string" || !TTS_ALLOWED_VOICES.has(voice)) {
      return NextResponse.json({ error: "Unsupported voice" }, { status: 400 });
    }

    if (typeof speed !== "number" || !Number.isFinite(speed)) {
      return NextResponse.json(
        { error: "speed must be a finite number" },
        { status: 400 },
      );
    }
    const rate = Math.min(Math.max(speed, 0.25), 4);

    // TTS generation
    const audioBuffer = await ttsProvider.generateSpeech(text, {
      voice,
      rate,
    });

    return new NextResponse(audioBuffer, {
      headers: {
        // OpenAI answers with mp3; see packages/tts/src/openai/index.ts.
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("TTS API Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 },
    );
  }
}
