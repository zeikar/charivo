import { NextRequest, NextResponse } from "next/server";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// `@charivo/stt/openai-realtime` ships no key-bearing helper: the app owns the
// credentials and the SDP exchange. This route is the server side of that
// transcriber's `bootstrap` — mint an ephemeral secret for a
// `type: "transcription"` session, then trade the browser's offer for an answer.

type TranscriptionBootstrapRequest = {
  sdpOffer?: string;
  session?: { model?: string; language?: string };
};

/**
 * Mint an ephemeral client secret for a transcription-only realtime session.
 * `turn_detection: null` keeps the server from segmenting the utterance, so the
 * single commit the transcriber sends at stop is the only commit in the session.
 */
async function mintTranscriptionSecret(
  apiKey: string,
  model: string,
  language: string | undefined,
): Promise<string> {
  const transcription: Record<string, unknown> = { model };
  if (language) {
    transcription.language = language;
  }

  const response = await fetch(CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: { input: { transcription, turn_detection: null } },
      },
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `[step 1/2 client_secrets] mint failed with ${response.status}: ${body}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`[step 1/2 client_secrets] response was not JSON: ${body}`);
  }

  // The API returns the secret at the top level `value` for transcription
  // sessions; `client_secret.value` is the older shape. Accept both.
  const record = payload as {
    value?: unknown;
    client_secret?: { value?: unknown };
  };
  const secret =
    typeof record.value === "string"
      ? record.value
      : record.client_secret?.value;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(
      "[step 1/2 client_secrets] response had no ephemeral secret (checked `value` and `client_secret.value`)",
    );
  }

  return secret;
}

/**
 * Trade the browser's SDP offer for the realtime answer SDP, authenticated with
 * the ephemeral secret rather than the standing API key.
 */
async function exchangeSdp(
  ephemeralKey: string,
  sdpOffer: string,
): Promise<string> {
  const response = await fetch(CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      "Content-Type": "application/sdp",
    },
    body: sdpOffer,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `[step 2/2 realtime/calls] SDP exchange failed with ${response.status}: ${body}`,
    );
  }

  if (!body.startsWith("v=")) {
    throw new Error(
      `[step 2/2 realtime/calls] response body was not SDP: ${body}`,
    );
  }

  return body;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TranscriptionBootstrapRequest;
    if (!body.sdpOffer) {
      return NextResponse.json(
        { error: "sdpOffer is required" },
        { status: 400 },
      );
    }

    if (!body.session?.model) {
      return NextResponse.json(
        { error: "session.model is required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const ephemeralKey = await mintTranscriptionSecret(
      apiKey,
      body.session.model,
      body.session.language,
    );
    const answerSdp = await exchangeSdp(ephemeralKey, body.sdpOffer);

    return NextResponse.json({ answerSdp });
  } catch (error) {
    console.error("Realtime transcription session error:", error);
    return NextResponse.json(
      {
        error: "Failed to create Realtime transcription session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
