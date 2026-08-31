import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";

type JsonRecord = Record<string, unknown>;

const harnessRoot = __dirname;

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

// The browser chooses from these; it cannot name a model of its own. Verified
// against the live API 2026-08-29 — see README "What the probes established".
const ALLOWED_MODELS = new Set([
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
]);

const ALLOWED_VOICES = new Set([
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Zephyr",
  "Leda",
  "Orus",
]);

const MAX_INSTRUCTION_LENGTH = 2000;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
// Google's default window to *start* a session is 1 minute. This harness is
// clicked by hand, so give the tester a little longer between mint and connect.
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000;

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

export default defineConfig({
  root: harnessRoot,
  plugins: [
    {
      name: "gemini-live-token-route",
      configureServer(server) {
        server.middlewares.use(
          "/api/gemini-token",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const model = payload.model;
              const voice = payload.voice;
              const instruction = payload.instruction;

              if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
                sendJson(response, 400, {
                  error: `Unsupported model: ${String(model)}`,
                  allowed: [...ALLOWED_MODELS],
                });
                return;
              }

              if (typeof voice !== "string" || !ALLOWED_VOICES.has(voice)) {
                sendJson(response, 400, {
                  error: `Unsupported voice: ${String(voice)}`,
                  allowed: [...ALLOWED_VOICES],
                });
                return;
              }

              if (
                typeof instruction !== "string" ||
                instruction.length > MAX_INSTRUCTION_LENGTH
              ) {
                sendJson(response, 400, {
                  error: `instruction must be a string of at most ${MAX_INSTRUCTION_LENGTH} characters`,
                });
                return;
              }

              if (!process.env.GEMINI_API_KEY) {
                sendJson(response, 500, {
                  error: "GEMINI_API_KEY not configured",
                });
                return;
              }

              // `bidiGenerateContentSetup` REPLACES the client's setup frame
              // rather than validating it, so the whole session config has to
              // be built here. That is not a burden — it is the defence: a
              // token minted without it lets the holder pick any model and any
              // config on the key owner's bill (verified: an unconstrained
              // token happily opened a session for a model the page never
              // offered).
              const now = Date.now();
              const upstream = await fetch(
                `${AUTH_TOKENS_URL}?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    uses: 1,
                    expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
                    newSessionExpireTime: new Date(
                      now + NEW_SESSION_WINDOW_MS,
                    ).toISOString(),
                    bidiGenerateContentSetup: {
                      model: `models/${model}`,
                      generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                          voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voice },
                          },
                        },
                      },
                      systemInstruction: { parts: [{ text: instruction }] },
                      inputAudioTranscription: {},
                      outputAudioTranscription: {},
                    },
                  }),
                },
              );

              const bodyText = await upstream.text();

              if (!upstream.ok) {
                console.error(
                  `[gemini-token] ${upstream.status} ${upstream.statusText}: ${bodyText}`,
                );
                sendJson(response, 502, {
                  error: "Token mint failed",
                  status: upstream.status,
                  details: bodyText,
                });
                return;
              }

              const minted = JSON.parse(bodyText) as JsonRecord;
              const token = minted.name;

              if (typeof token !== "string") {
                sendJson(response, 502, {
                  error: "Token mint returned no name field",
                  details: bodyText,
                });
                return;
              }

              sendJson(response, 200, { token, model });
            } catch (error) {
              sendJson(response, 500, {
                error: "Failed to mint ephemeral token",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              });
            }
          },
        );
      },
    },
  ],
});
