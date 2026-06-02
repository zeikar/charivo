import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createOpenAILLMProvider,
  createOpenAISTTProvider,
  createOpenAITTSProvider,
} from "../../packages/server/src/openai/index";
import { workspaceAliases } from "../../test-aliases";
import { defineConfig } from "vite";

type JsonRecord = Record<string, unknown>;

const harnessRoot = __dirname;

// These routes are intentionally local to the cascade harness so the smoke
// test can validate the STT → LLM → TTS chain without depending on
// examples/web. They mirror the examples/web /api/stt, /api/chat, /api/tts
// route contracts, backed by @charivo/server/openai.

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

function requireApiKey(response: ServerResponse): string | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(response, 500, { error: "OPENAI_API_KEY not configured" });
    return null;
  }

  return apiKey;
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

            const apiKey = requireApiKey(response);
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
                body: rawBody,
              });
              const form = await webRequest.formData();
              const audio = form.get("audio");
              const language = form.get("language");

              if (!(audio instanceof Blob)) {
                sendJson(response, 400, { error: "Audio file is required" });
                return;
              }

              const provider = createOpenAISTTProvider({
                apiKey,
                defaultModel: "whisper-1",
              });
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

            const apiKey = requireApiKey(response);
            if (!apiKey) {
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const messages = payload.messages;

              if (!Array.isArray(messages)) {
                sendJson(response, 400, {
                  success: false,
                  error: "Messages array is required",
                });
                return;
              }

              const provider = createOpenAILLMProvider({
                apiKey,
                model: "gpt-4.1-nano",
              });
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

        // TTS: { text, voice, speed } → audio/wav buffer
        server.middlewares.use(
          "/api/tts",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            if (request.method !== "POST") {
              next();
              return;
            }

            const apiKey = requireApiKey(response);
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

              const provider = createOpenAITTSProvider({
                apiKey,
                defaultVoice: "marin",
                defaultModel: "gpt-4o-mini-tts",
              });
              const audioBuffer = await provider.generateSpeech(text, {
                voice:
                  typeof payload.voice === "string" ? payload.voice : "marin",
                rate: typeof payload.speed === "number" ? payload.speed : 1.0,
              });

              response.statusCode = 200;
              response.setHeader("Content-Type", "audio/wav");
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
