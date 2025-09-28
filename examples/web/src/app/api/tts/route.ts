import { NextRequest, NextResponse } from "next/server";
import { createOpenAITTSAdapter } from "@charivo/adapter-tts-openai";

// OpenAI TTS Adapter 초기화
const ttsAdapter = createOpenAITTSAdapter({
  apiKey: process.env.OPENAI_API_KEY!,
  defaultVoice: "alloy",
  defaultModel: "tts-1-hd",
});

export async function POST(request: NextRequest) {
  try {
    const {
      text,
      voice = "alloy",
      speed = 1.0,
      format = "mp3",
    } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    // TTS 생성
    const audioBuffer = await ttsAdapter.generateSpeech(text, {
      voice,
      rate: speed,
    });

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": format === "mp3" ? "audio/mpeg" : `audio/${format}`,
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
