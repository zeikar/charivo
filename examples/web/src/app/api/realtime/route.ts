/**
 * OpenAI Realtime API - WebRTC Session Endpoint
 *
 * Creates a Realtime API session using the unified interface.
 * Client sends SDP offer → Server forwards to OpenAI → Returns SDP answer
 */

import { NextRequest, NextResponse } from "next/server";
import { getEmotionSessionConfig } from "@charivo/realtime-core";
import type { RealtimeSessionConfig } from "@charivo/realtime-core";

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let sdpOffer = "";
    let sessionConfig: RealtimeSessionConfig | undefined;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        sdpOffer?: string;
        sessionConfig?: RealtimeSessionConfig;
      };
      sdpOffer = body.sdpOffer || "";
      sessionConfig = body.sessionConfig;
    } else {
      // Backward compatibility for legacy clients
      sdpOffer = await request.text();
    }

    if (!sdpOffer) {
      return NextResponse.json(
        { error: "SDP offer is required" },
        { status: 400 },
      );
    }

    // Create multipart form with SDP + session config
    const formData = new FormData();
    formData.set("sdp", sdpOffer);
    formData.set(
      "session",
      JSON.stringify(getEmotionSessionConfig(sessionConfig)),
    );

    // Forward to OpenAI
    const response = await fetch(OPENAI_REALTIME_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenAI Realtime API error:", error);
      return NextResponse.json(
        { error: "Failed to create Realtime session", details: error },
        { status: response.status },
      );
    }

    const sdpAnswer = await response.text();
    return new NextResponse(sdpAnswer, {
      headers: { "Content-Type": "application/sdp" },
    });
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
