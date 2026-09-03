import { NextRequest, NextResponse } from "next/server";
import { createGeminiSTTProvider } from "@charivo/server/gemini";
import { STT_GEMINI_MODEL, STT_MAX_AUDIO_BYTES } from "../demo-limits";

function getGeminiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    // The free tier allows 3 requests/min on this model; a 429 lands here as
    // the generic 500.
    const sttProvider = createGeminiSTTProvider({
      apiKey: getGeminiKey(),
      defaultModel: STT_GEMINI_MODEL,
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

    // Transcription bills per audio minute; file size is the only proxy for
    // that available before paying for the request.
    if (audioFile.size > STT_MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: `Audio exceeds ${STT_MAX_AUDIO_BYTES} bytes` },
        { status: 413 },
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
    console.error("Gemini STT API Error:", error);
    return NextResponse.json(
      { error: "Failed to transcribe audio" },
      { status: 500 },
    );
  }
}
