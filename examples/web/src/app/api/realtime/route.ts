import { NextRequest, NextResponse } from "next/server";
import {
  createOpenAIRealtimeProvider,
  type OpenAIRealtimeProviderConfig,
} from "@charivo/realtime-provider-openai";
import type { RealtimeSessionRequest } from "@charivo/core";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Partial<RealtimeSessionRequest>;
    if (!body.transport || !body.session) {
      return NextResponse.json(
        { error: "transport and session are required" },
        { status: 400 },
      );
    }

    const providerConfig: OpenAIRealtimeProviderConfig = {
      apiKey,
    };
    const provider = createOpenAIRealtimeProvider(providerConfig);

    const bootstrap = await provider.createSession({
      transport: body.transport,
      session: body.session,
      sdpOffer: body.sdpOffer,
    });

    return NextResponse.json(bootstrap);
  } catch (error) {
    console.error("Realtime session error:", error);
    return NextResponse.json(
      {
        error: "Failed to create Realtime session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
