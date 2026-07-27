import { NextRequest, NextResponse } from "next/server";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

const MINT_STEP = "step 1/2 client_secrets";
const EXCHANGE_STEP = "step 2/2 realtime/calls";

// The transcriber abandons the bootstrap after 15s (BOOTSTRAP_TIMEOUT_MS in
// @charivo/stt/openai-realtime). Give up first, with headroom, so a slow
// upstream call cannot outlive the browser's cleanup and leave an orphaned —
// billable — session running. This is the budget for BOTH steps together: one
// signal covers the whole exchange rather than restarting the clock per call.
const BOOTSTRAP_DEADLINE_MS = 12_000;

// `@charivo/stt/openai-realtime` ships no key-bearing helper: the app owns the
// credentials and the SDP exchange. This route is the server side of that
// transcriber's `bootstrap` — mint an ephemeral secret for a
// `type: "transcription"` session, then trade the browser's offer for an answer.

type TranscriptionBootstrapRequest = {
  sdpOffer?: string;
  session?: { model?: string; language?: string };
};

/**
 * Run one upstream call against the shared deadline. The body read happens here
 * too, because an abort errors the response stream as well as the request.
 */
async function fetchWithDeadline(
  step: string,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const response = await fetch(url, { ...init, signal });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`[${step}] timed out after ${BOOTSTRAP_DEADLINE_MS}ms`);
    }
    throw new Error(
      `[${step}] request failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Mint an ephemeral client secret for a transcription-only realtime session.
 * `turn_detection: null` keeps the server from segmenting the utterance, so the
 * single commit the transcriber sends at stop is the only commit in the session.
 */
async function mintTranscriptionSecret(
  apiKey: string,
  model: string,
  language: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const transcription: Record<string, unknown> = { model };
  if (language) {
    transcription.language = language;
  }

  const { ok, status, body } = await fetchWithDeadline(
    MINT_STEP,
    CLIENT_SECRETS_URL,
    {
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
    },
    signal,
  );

  if (!ok) {
    throw new Error(`[${MINT_STEP}] mint failed with ${status}: ${body}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`[${MINT_STEP}] response was not JSON: ${body}`);
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
      `[${MINT_STEP}] response had no ephemeral secret (checked \`value\` and \`client_secret.value\`)`,
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
  signal: AbortSignal,
): Promise<string> {
  const { ok, status, body } = await fetchWithDeadline(
    EXCHANGE_STEP,
    CALLS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
      body: sdpOffer,
    },
    signal,
  );

  if (!ok) {
    throw new Error(
      `[${EXCHANGE_STEP}] SDP exchange failed with ${status}: ${body}`,
    );
  }

  if (!body.startsWith("v=")) {
    throw new Error(`[${EXCHANGE_STEP}] response body was not SDP: ${body}`);
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

    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      BOOTSTRAP_DEADLINE_MS,
    );

    try {
      const ephemeralKey = await mintTranscriptionSecret(
        apiKey,
        body.session.model,
        body.session.language,
        controller.signal,
      );
      const answerSdp = await exchangeSdp(
        ephemeralKey,
        body.sdpOffer,
        controller.signal,
      );

      return NextResponse.json({ answerSdp });
    } finally {
      clearTimeout(deadline);
    }
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
