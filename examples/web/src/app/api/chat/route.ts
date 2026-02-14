import { NextRequest, NextResponse } from "next/server";
import { createOpenAILLMProvider } from "@charivo/llm-provider-openai";

function getOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  try {
    const llmProvider = createOpenAILLMProvider({
      apiKey: getOpenAIKey(),
      model: "gpt-4.1-nano",
    });

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 },
      );
    }

    // LLM Provider를 사용해서 응답 생성
    const assistantMessage = await llmProvider.generateResponse(messages);

    return NextResponse.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error) {
    console.error("LLM Provider Error:", error);

    return NextResponse.json(
      {
        error: "Failed to generate response",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
