import { NextRequest, NextResponse } from "next/server";
import { createOpenAILLMProvider } from "@charivo/server/openai";
import { parseChatRequest, requiresToolCallingPath } from "../chat-request";

function getOpenAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseChatRequest(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const llmProvider = createOpenAILLMProvider({
      apiKey: getOpenAIKey(),
      model: "gpt-4.1-nano",
    });

    const { messages, tools } = parsed.value;

    if (requiresToolCallingPath(parsed.value)) {
      const result = await llmProvider.generateResponseWithTools(
        messages,
        tools ?? [],
      );

      return NextResponse.json({
        success: true,
        message: result.content,
        toolCalls: result.toolCalls,
      });
    }

    // Generate a response using the LLM Provider
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
