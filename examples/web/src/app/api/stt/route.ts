import { NextRequest, NextResponse } from "next/server";
import { createOpenAISTTProvider } from "@charivo/stt-provider-openai";

function getOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    const sttProvider = createOpenAISTTProvider({
      apiKey: getOpenAIKey(),
      defaultModel: "whisper-1",
    });

    // FormData에서 audio 파일 읽기
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 },
      );
    }

    // File을 Blob으로 변환
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type,
    });

    // STT 변환
    const transcription = await sttProvider.transcribe(audioBlob);

    return NextResponse.json({ transcription });
  } catch (error) {
    console.error("STT API Error:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 },
    );
  }
}
