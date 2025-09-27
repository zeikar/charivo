import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const {
      text,
      voice = "alloy",
      model = "tts-1",
      speed = 1.0,
      format = "mp3",
    } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    // OpenAI TTS API 호출
    const response = await openai.audio.speech.create({
      model: model as "tts-1" | "tts-1-hd",
      voice: voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      input: text,
      response_format: format as "mp3" | "opus" | "aac" | "flac",
      speed: Math.max(0.25, Math.min(4.0, speed)),
    });

    // 오디오 데이터를 ArrayBuffer로 변환
    const audioBuffer = await response.arrayBuffer();

    // 적절한 Content-Type 설정
    const contentType =
      format === "mp3"
        ? "audio/mpeg"
        : format === "opus"
          ? "audio/opus"
          : format === "aac"
            ? "audio/aac"
            : format === "flac"
              ? "audio/flac"
              : "audio/mpeg";

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("OpenAI TTS API Error:", error);

    return NextResponse.json(
      {
        error: "Failed to generate speech",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
