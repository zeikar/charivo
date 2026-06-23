import { NextRequest, NextResponse } from "next/server";
import { createOpenAISTTProvider } from "@charivo/server/openai";

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

    // Read the audio file from FormData
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const language = formData.get("language");

    if (!audioFile) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 },
      );
    }

    // Convert the File to a Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type,
    });

    // STT transcription
    const transcription = await sttProvider.transcribe(audioBlob, {
      language: typeof language === "string" ? language : undefined,
    });

    return NextResponse.json({ transcription });
  } catch (error) {
    console.error("STT API Error:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 },
    );
  }
}
