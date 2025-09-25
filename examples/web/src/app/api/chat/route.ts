import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// OpenAI 클라이언트 초기화
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 },
      );
    }

    // OpenAI API 호출 (클라이언트에서 이미 처리된 메시지 형식 그대로 사용)
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      messages: messages,
    });

    const assistantMessage = response.choices[0]?.message?.content || "";

    return NextResponse.json({
      success: true,
      message: assistantMessage,
      usage: response.usage,
    });
  } catch (error) {
    console.error("OpenAI API Error:", error);

    return NextResponse.json(
      {
        error: "Failed to generate response",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
