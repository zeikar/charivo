import { NextRequest, NextResponse } from "next/server";
import { createOpenClawLLMProvider } from "@charivo/server/openclaw";
import { parseChatRequest, requiresToolCallingPath } from "../chat-request";

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
    const llmProvider = createOpenClawLLMProvider({
      token: process.env.OPENCLAW_TOKEN ?? "",
      baseURL: process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789/v1",
      agentId: process.env.OPENCLAW_AGENT_ID ?? "main",
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
