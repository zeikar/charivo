import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSProvider } from "@charivo/tts-provider-openai";

function getOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    const ttsProvider = createOpenAITTSProvider({
      apiKey: getOpenAIKey(),
      defaultVoice: "marin",
      defaultModel: "gpt-4o-mini-tts",
    });

    const { text, voice = "marin", speed = 1.0 } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    // TTS 생성
    const audioBuffer = await ttsProvider.generateSpeech(text, {
      voice,
      rate: speed,
    });

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/wav",
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
