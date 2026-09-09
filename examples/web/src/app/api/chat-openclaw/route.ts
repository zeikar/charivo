import { NextRequest, NextResponse } from "next/server";
import { createOpenClawLLMProvider } from "@charivo/server/openclaw";
import { parseChatRequest, requiresToolCallingPath } from "../chat-request";

/**
 * Local-only, matching the two menu entries this route serves: `ChatSettings`
 * drops them from a production build, so a deployed demo cannot reach here
 * through the UI, and `OPENCLAW_BASE_URL` defaults to the server's own
 * localhost — where a deployment has nothing listening. Without this the route
 * would still answer a direct POST, forwarding `OPENCLAW_TOKEN` to whatever
 * that variable names.
 *
 * 404 rather than 403: a route that cannot serve anyone in this build should
 * look absent, not forbidden. Next.js substitutes `NODE_ENV` with a literal at
 * build time, so the branch is decided at compile time — the same mechanism the
 * session caps in `api/demo-limits.ts` rely on, with no runtime switch to get
 * wrong.
 */
const LOCAL_ONLY = process.env.NODE_ENV !== "production";

export async function POST(request: NextRequest) {
  if (!LOCAL_ONLY) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
