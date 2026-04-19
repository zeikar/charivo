import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenAIRealtimeProvider } from "../../packages/server/src/openai/index";
import { workspaceAliases } from "../../test-aliases";
import { defineConfig } from "vite";

type JsonRecord = Record<string, unknown>;

const harnessRoot = __dirname;

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
  resolve: {
    alias: workspaceAliases,
  },
  plugins: [
    {
      name: "charivo-realtime-bootstrap-route",
      configureServer(server) {
        server.middlewares.use(
          "/api/realtime",
          async (request: IncomingMessage, response: ServerResponse, next) => {
            // This route is intentionally local to the WebRTC harness so the
            // smoke test can validate realtime packages without depending on
            // examples/web. The live-bootstrap suite covers the examples/web
            // route contract separately.
            if (request.method !== "POST") {
              next();
              return;
            }

            try {
              const payload = await readJsonBody(request);
              const transport = payload.transport;
              const session = payload.session;

              if (
                typeof transport !== "string" ||
                typeof session !== "object" ||
                session === null
              ) {
                sendJson(response, 400, {
                  error: "transport and session are required",
                });
                return;
              }

              const providerName =
                typeof (session as JsonRecord).provider === "string"
                  ? (session as JsonRecord).provider
                  : undefined;

              if (providerName !== "openai") {
                sendJson(response, 501, {
                  error: `Unsupported realtime provider: ${providerName ?? "(unspecified)"}`,
                });
                return;
              }

              if (!process.env.OPENAI_API_KEY) {
                sendJson(response, 500, {
                  error: "OPENAI_API_KEY not configured",
                });
                return;
              }

              const provider = createOpenAIRealtimeProvider({
                apiKey: process.env.OPENAI_API_KEY,
              });

              const bootstrap = await provider.createSession({
                adapter:
                  typeof payload.adapter === "string"
                    ? payload.adapter
                    : undefined,
                transport,
                session: session as Record<string, unknown>,
                sdpOffer:
                  typeof payload.sdpOffer === "string"
                    ? payload.sdpOffer
                    : undefined,
              });

              sendJson(response, 200, bootstrap as JsonRecord);
            } catch (error) {
              sendJson(response, 500, {
                error: "Failed to create realtime session",
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
