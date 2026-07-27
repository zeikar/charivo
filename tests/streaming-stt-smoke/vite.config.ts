import type { IncomingMessage, ServerResponse } from "node:http";
import { workspaceAliases } from "../../test-aliases";
import { defineConfig } from "vite";

type JsonRecord = Record<string, unknown>;

const harnessRoot = __dirname;

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

// This route is intentionally local to the streaming STT harness. No
// key-bearing helper ships with @charivo/stt/openai-realtime — the app owns the
// credentials and the SDP exchange — so the harness implements the consumer
// side of `bootstrap` exactly as the package docs describe it: mint an
// ephemeral secret for a `type: "transcription"` session, then trade the
// browser's SDP offer for an answer.

function sendJson(
  response: ServerResponse,
  status: number,
  payload: JsonRecord,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as JsonRecord;
}

/**
 * Mint an ephemeral client secret for a transcription-only realtime session.
 * `turn_detection: null` keeps the server from segmenting the utterance, so the
 * single commit sent at stop is the only commit in the session.
 */
async function mintTranscriptionSecret(
  apiKey: string,
  model: string,
  language: string | undefined,
): Promise<string> {
  const transcription: JsonRecord = { model };
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
  // sessions; `client_secret.value` is the older shape. `OpenAIRealtimeProvider`
  // accepts both, so this route does too.
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

export default defineConfig({
  root: harnessRoot,
  resolve: {
    alias: workspaceAliases,
  },
  plugins: [
    {
      name: "charivo-streaming-stt-bootstrap-route",
      configureServer(server) {
        // Bootstrap: { sdpOffer, session: { model, language? } } → { answerSdp }
        server.middlewares.use(
          "/api/realtime-transcription",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
              sendJson(response, 500, {
                error: "OPENAI_API_KEY not configured",
              });
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const sdpOffer = payload.sdpOffer;
              const session = payload.session as JsonRecord | undefined;
              const model = session?.model;
              const language = session?.language;

              if (typeof sdpOffer !== "string" || sdpOffer.length === 0) {
                sendJson(response, 400, { error: "sdpOffer is required" });
                return;
              }

              if (typeof model !== "string" || model.length === 0) {
                sendJson(response, 400, { error: "session.model is required" });
                return;
              }

              const ephemeralKey = await mintTranscriptionSecret(
                apiKey,
                model,
                typeof language === "string" ? language : undefined,
              );
              const answerSdp = await exchangeSdp(ephemeralKey, sdpOffer);

              sendJson(response, 200, { answerSdp });
            } catch (error) {
              sendJson(response, 500, {
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to bootstrap the transcription session",
              });
            }
          },
        );
      },
    },
  ],
});
