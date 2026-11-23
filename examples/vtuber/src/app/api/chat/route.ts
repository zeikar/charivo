import { NextRequest, NextResponse } from "next/server";
import { createGeminiLLMProvider } from "@charivo/server/gemini";
import { parseChatRequest } from "../chat-request";
import { CHAT_GEMINI_MODEL, TOOL_CALLS_PER_ROUND } from "../demo-limits";
import { boundReply } from "../reply-budget";

// The route is unauthenticated and the app is loopback-only, so a page on
// another origin must not be able to drive it from the user's browser. A
// non-browser caller sends no Origin, and a JSON content type cannot be sent
// cross-origin without a preflight, which this route never answers.
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3002",
  "http://localhost:3002",
]);

function getGeminiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return apiKey;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
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
    const llmProvider = createGeminiLLMProvider({
      apiKey: getGeminiKey(),
      model: CHAT_GEMINI_MODEL,
    });

    const { messages, tools } = parsed.value;
    const result = await llmProvider.generateResponseWithTools(messages, tools);

    return NextResponse.json({
      success: true,
      message: boundReply(result.content),
      // The request budgets assume at most TOOL_CALLS_PER_ROUND calls per
      // round; more would push the next request past the message cap, so
      // the extra calls are dropped.
      toolCalls: result.toolCalls?.slice(0, TOOL_CALLS_PER_ROUND),
    });
  } catch (error) {
    console.error("Gemini LLM Provider Error:", error);

    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 },
    );
  }
}
