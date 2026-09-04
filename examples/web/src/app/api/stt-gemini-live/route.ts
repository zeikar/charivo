import { NextRequest, NextResponse } from "next/server";
import { STT_GEMINI_LIVE_MODEL } from "../demo-limits";

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GEMINI_LIVE_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

const MINT_STEP = "auth_tokens";

// The transcriber abandons the bootstrap after 15s (BOOTSTRAP_TIMEOUT_MS in
// @charivo/stt/gemini-live). Give up first, with headroom, so the browser gets
// an error from here instead of hitting its own timeout, and a slow mint cannot
// hand back a token after nobody is listening for it.
const BOOTSTRAP_DEADLINE_MS = 12_000;

// `@charivo/stt/gemini-live` ships no key-bearing helper: the app owns the
// credentials. This route is the server side of that transcriber's
// `bootstrap` — mint a single-use ephemeral token and hand back the websocket
// url it is good for.

type StreamingTranscriptionBootstrapRequest = {
  /**
   * `model` is accepted for wire compatibility with the transcriber but
   * ignored — this route pays for whatever it mints, so it picks the model.
   */
  session?: { model?: string; language?: string };
};

/**
 * Mint a single-use ephemeral token for a transcription-only Live API session.
 *
 * The token's `bidiGenerateContentSetup` REPLACES the browser's setup frame
 * rather than validating it, for the reason `toMintBody` in
 * `packages/server/src/gemini/realtime/index.ts` records: an unconstrained
 * token lets its holder pick any model on the key owner's bill. So the whole
 * setup is built here and only `language` comes from the caller. Manual VAD is
 * part of that: pinned only in the browser's setup frame it would be replaced
 * away, and the server would segment the recording on its own.
 *
 * Expiry is left to Google's defaults — the browser connects immediately after
 * minting — and `uses: 1` means a reconnect has to come back here for a fresh
 * token.
 *
 * The demo's AI Studio key has no RPM limit on this model, only a TPM limit
 * that scales with the audio's duration. So unlike the unary `/api/stt-gemini`
 * route, request count is not what bounds spend here: the browser-side
 * recording cap is.
 */
async function mintLiveTranscriptionToken(
  apiKey: string,
  language: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const inputAudioTranscription: Record<string, unknown> = { mode: "VERBATIM" };
  if (language) {
    inputAudioTranscription.languageCodes = [language];
  }

  let ok: boolean;
  let status: number;
  let body: string;
  try {
    const response = await fetch(AUTH_TOKENS_URL, {
      method: "POST",
      headers: {
        // Never in the URL: proxies and request logs capture query strings.
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uses: 1,
        bidiGenerateContentSetup: {
          model: `models/${STT_GEMINI_LIVE_MODEL}`,
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription,
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
        },
      }),
      signal,
    });
    ok = response.ok;
    status = response.status;
    // Read the body here too: an abort errors the response stream as well as
    // the request.
    body = await response.text();
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `[${MINT_STEP}] timed out after ${BOOTSTRAP_DEADLINE_MS}ms`,
      );
    }
    throw new Error(
      `[${MINT_STEP}] request failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }

  if (!ok) {
    // The upstream body reaches the caller in `details`; Google's auth errors
    // describe the key without echoing it back (measured 2026-09-04 against a
    // deliberately invalid key: "API key not valid. Please pass a valid API
    // key."). Check that again before widening what `details` carries.
    throw new Error(`[${MINT_STEP}] mint failed with ${status}: ${body}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`[${MINT_STEP}] response was not JSON: ${body}`);
  }

  const token = (payload as { name?: unknown }).name;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`[${MINT_STEP}] response had no ephemeral token \`name\``);
  }

  return token;
}

export async function POST(request: NextRequest) {
  try {
    const body =
      (await request.json()) as StreamingTranscriptionBootstrapRequest;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured" },
        { status: 500 },
      );
    }

    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      BOOTSTRAP_DEADLINE_MS,
    );

    try {
      const token = await mintLiveTranscriptionToken(
        apiKey,
        body.session?.language,
        controller.signal,
      );

      return NextResponse.json({
        url: GEMINI_LIVE_WEBSOCKET_URL,
        token,
      });
    } finally {
      clearTimeout(deadline);
    }
  } catch (error) {
    console.error("Gemini Live transcription token error:", error);
    return NextResponse.json(
      {
        error: "Failed to mint the streaming transcription token",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
