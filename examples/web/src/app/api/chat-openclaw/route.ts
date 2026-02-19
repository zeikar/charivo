import { NextRequest, NextResponse } from "next/server";
import { createOpenClawLLMProvider } from "@charivo/llm-provider-openclaw";

export async function POST(request: NextRequest) {
  try {
    const llmProvider = createOpenClawLLMProvider({
      token: process.env.OPENCLAW_TOKEN ?? "",
      baseURL: process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789/v1",
      agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
    });

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 },
      );
    }

    const assistantMessage = await llmProvider.generateResponse(messages);

    return NextResponse.json({
      success: true,
      message: assistantMessage,
    });
  } catch (error) {
    console.error("OpenClaw LLM Provider Error:", error);

    return NextResponse.json(
      {
        error: "Failed to generate response",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
