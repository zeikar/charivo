/**
 * OpenAI Realtime API - WebRTC Session Endpoint
 *
 * This endpoint implements the "unified interface" approach for WebRTC connections.
 * The client sends its SDP offer, and this server combines it with session config
 * and forwards it to OpenAI's Realtime API.
 *
 * Flow:
 * 1. Client creates WebRTC peer connection and generates SDP offer
 * 2. Client POSTs SDP to this endpoint
 * 3. Server combines SDP + session config and sends to OpenAI
 * 4. OpenAI returns SDP answer
 * 5. Client completes WebRTC connection with the answer
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 },
    );
  }

  try {
    // Get SDP offer from client
    const sdpOffer = await request.text();

    if (!sdpOffer) {
      return NextResponse.json(
        { error: "SDP offer is required" },
        { status: 400 },
      );
    }

    // Session configuration (following OpenAI docs format)
    const sessionConfig = {
      type: "realtime",
      model: "gpt-realtime",
      audio: {
        output: {
          voice: "verse",
        },
      },
    };

    // Create multipart form data
    const formData = new FormData();
    formData.set("sdp", sdpOffer);
    formData.set("session", JSON.stringify(sessionConfig));

    // Forward to OpenAI Realtime API
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Realtime API error:", errorText);
      return NextResponse.json(
        { error: "Failed to create Realtime session", details: errorText },
        { status: response.status },
      );
    }

    // Return SDP answer to client
    const sdpAnswer = await response.text();

    return new NextResponse(sdpAnswer, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
      },
    });
  } catch (error) {
    console.error("Realtime session creation error:", error);

    return NextResponse.json(
      {
        error: "Failed to create Realtime session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
