import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createOpenAILLMProvider,
  createOpenAISTTProvider,
  createOpenAITTSProvider,
} from "../../packages/server/src/openai/index";
import {
  createGeminiLLMProvider,
  createGeminiSTTProvider,
  createGeminiTTSProvider,
} from "../../packages/server/src/gemini/index";
import type { LLMMessage, ToolDefinition } from "../../packages/core/src/types";
import { workspaceAliases } from "../../test-aliases";
import { defineConfig } from "vite";

type JsonRecord = Record<string, unknown>;

const harnessRoot = __dirname;

// These routes are intentionally local to the cascade harness so the smoke
// test can validate the STT → LLM → TTS chain without depending on
// examples/web. They mirror the examples/web /api/stt, /api/chat, /api/tts
// route contracts, backed by @charivo/server/openai. CASCADE_STT=gemini,
// CASCADE_LLM=gemini, and CASCADE_TTS=gemini each swap only their own leg to
// @charivo/server/gemini, independently of one another, so the same specs can
// drive any mix of providers end to end.

function sendJson(
  response: ServerResponse,
  status: number,
  payload: JsonRecord,
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const rawBody = (await readRawBody(request)).toString("utf8");
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody) as JsonRecord;
}

// Minimal tool-turn detection mirroring examples/web's requiresToolCallingPath:
// a `tools` key (even an empty array) or a tool-ish message (a "tool" turn, or
// an assistant turn carrying toolCalls) routes through the tool-calling
// provider call instead of the plain chat call.
function isToolishMessage(message: unknown): boolean {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const record = message as JsonRecord;
  if (record.role === "tool") {
    return true;
  }

  return (
    record.role === "assistant" &&
    Array.isArray(record.toolCalls) &&
    record.toolCalls.length > 0
  );
}

type ApiKeyEnv = "OPENAI_API_KEY" | "GEMINI_API_KEY";

function requireApiKey(
  response: ServerResponse,
  envName: ApiKeyEnv,
): string | null {
  const apiKey = process.env[envName];
  if (!apiKey) {
    sendJson(response, 500, { error: `${envName} not configured` });
    return null;
  }

  return apiKey;
}

type CascadeProvider = "openai" | "gemini";

// Resolved once at config load so a typo fails the run up front instead of
// silently testing the default provider.
function resolveCascadeSwitch(
  name: "CASCADE_STT" | "CASCADE_LLM" | "CASCADE_TTS",
): CascadeProvider {
  const value = process.env[name] ?? "openai";
  if (value !== "openai" && value !== "gemini") {
    throw new Error(
      `${name} must be "openai" or "gemini", received "${value}"`,
    );
  }

  return value;
}
const CASCADE_STT = resolveCascadeSwitch("CASCADE_STT");
const CASCADE_LLM = resolveCascadeSwitch("CASCADE_LLM");
const CASCADE_TTS = resolveCascadeSwitch("CASCADE_TTS");

const STT_API_KEY_ENV: ApiKeyEnv =
  CASCADE_STT === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";

function createSTTProvider(apiKey: string) {
  return CASCADE_STT === "gemini"
    ? // timeoutMs below @charivo/stt/remote's fixed 30s so the harness route
      // gives up before the browser does.
      createGeminiSTTProvider({
        apiKey,
        defaultModel: "gemini-3.5-transcribe",
        timeoutMs: 25_000,
      })
    : createOpenAISTTProvider({ apiKey, defaultModel: "whisper-1" });
}

const LLM_API_KEY_ENV: ApiKeyEnv =
  CASCADE_LLM === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";

function createLLMProvider(apiKey: string) {
  return CASCADE_LLM === "gemini"
    ? createGeminiLLMProvider({ apiKey, model: "gemini-3.5-flash-lite" })
    : createOpenAILLMProvider({ apiKey, model: "gpt-4.1-nano" });
}

const TTS_API_KEY_ENV: ApiKeyEnv =
  CASCADE_TTS === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";

function createTTSProvider(apiKey: string) {
  return CASCADE_TTS === "gemini"
    ? // timeoutMs below @charivo/tts/remote's fixed 30s so the harness route
      // gives up before the browser does - the same reason examples/web sets
      // TTS_GEMINI_ROUTE_TIMEOUT_MS.
      createGeminiTTSProvider({
        apiKey,
        defaultModel: "gemini-3.1-flash-tts-preview",
        timeoutMs: 25_000,
      })
    : createOpenAITTSProvider({
        apiKey,
        defaultVoice: "marin",
        defaultModel: "gpt-4o-mini-tts",
      });
}

export default defineConfig({
  root: harnessRoot,
  resolve: {
    alias: workspaceAliases,
  },
  plugins: [
    {
      name: "charivo-cascade-routes",
      configureServer(server) {
        // STT: multipart upload (audio + optional language) → { transcription }
        server.middlewares.use(
          "/api/stt",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            const apiKey = requireApiKey(response, STT_API_KEY_ENV);
            if (!apiKey) {
              return;
            }

            try {
              const rawBody = await readRawBody(request);
              const webRequest = new Request("http://localhost/api/stt", {
                method: "POST",
                headers: {
                  "content-type": request.headers["content-type"] ?? "",
                },
                // Buffer is not a BodyInit; a view over the same bytes is.
                body: new Uint8Array(rawBody),
              });
              const form = await webRequest.formData();
              const audio = form.get("audio");
              const language = form.get("language");

              if (!(audio instanceof Blob)) {
                sendJson(response, 400, { error: "Audio file is required" });
                return;
              }

              const provider = createSTTProvider(apiKey);
              const transcription = await provider.transcribe(audio, {
                language: typeof language === "string" ? language : undefined,
              });

              sendJson(response, 200, { transcription });
            } catch (error) {
              sendJson(response, 500, {
                error: "Failed to transcribe audio",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              });
            }
          },
        );

        // LLM: { messages } → { success, message }
        server.middlewares.use(
          "/api/chat",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            const apiKey = requireApiKey(response, LLM_API_KEY_ENV);
            if (!apiKey) {
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const messages = payload.messages;
              const tools = payload.tools;

              if (!Array.isArray(messages)) {
                sendJson(response, 400, {
                  success: false,
                  error: "Messages array is required",
                });
                return;
              }

              const provider = createLLMProvider(apiKey);

              if (tools !== undefined || messages.some(isToolishMessage)) {
                const result = await provider.generateResponseWithTools(
                  messages as LLMMessage[],
                  (tools as ToolDefinition[] | undefined) ?? [],
                );

                sendJson(response, 200, {
                  success: true,
                  message: result.content,
                  toolCalls: result.toolCalls,
                });
                return;
              }

              const message = await provider.generateResponse(
                messages as Array<{ role: string; content: string }>,
              );

              sendJson(response, 200, { success: true, message });
            } catch (error) {
              sendJson(response, 500, {
                success: false,
                error: "Failed to generate response",
                details:
                  error instanceof Error ? error.message : "Unknown error",
              });
            }
          },
        );

        // TTS: { text, voice, speed } → audio buffer in the provider's container
        server.middlewares.use(
          "/api/tts",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            const apiKey = requireApiKey(response, TTS_API_KEY_ENV);
            if (!apiKey) {
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const text = payload.text;

              if (typeof text !== "string" || text.length === 0) {
                sendJson(response, 400, {
                  error: "Text is required and must be a string",
                });
                return;
              }

              const provider = createTTSProvider(apiKey);
              // The harness character has no voice, and the remote player's
              // default voice ("marin") is an OpenAI name, so on the Gemini
              // leg the route pins a Gemini voice itself instead of forwarding
              // payload.voice/speed - CASCADE_TTS ignores rate entirely.
              const audioBuffer =
                CASCADE_TTS === "gemini"
                  ? await provider.generateSpeech(text, { voice: "Kore" })
                  : await provider.generateSpeech(text, {
                      voice:
                        typeof payload.voice === "string"
                          ? payload.voice
                          : "marin",
                      rate:
                        typeof payload.speed === "number" ? payload.speed : 1.0,
                    });

              response.statusCode = 200;
              // Mirrors the demo routes: Gemini's provider hands back a WAV it
              // wrapped itself, while OpenAI answers with mp3. The remote
              // player labels playback from this header, so naming one
              // container for both legs would mislabel one of them.
              response.setHeader(
                "Content-Type",
                CASCADE_TTS === "gemini" ? "audio/wav" : "audio/mpeg",
              );
              response.setHeader(
                "Content-Length",
                String(audioBuffer.byteLength),
              );
              response.end(Buffer.from(audioBuffer));
            } catch (error) {
              sendJson(response, 500, {
                error: "Failed to generate speech",
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
