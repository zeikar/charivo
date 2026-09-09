import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateResponse = vi.fn();
const generateResponseWithTools = vi.fn();
const createOpenClawLLMProvider = vi.fn(() => ({
  generateResponse,
  generateResponseWithTools,
}));

vi.mock("@charivo/server/openclaw", () => ({
  createOpenClawLLMProvider: (...args: unknown[]) =>
    createOpenClawLLMProvider(...(args as [])),
}));

import { POST } from "./route";

function postRequest(body: string) {
  return new Request("http://localhost/api/chat-openclaw", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/web /api/chat-openclaw route", () => {
  beforeEach(() => {
    createOpenClawLLMProvider.mockClear();
    generateResponse.mockReset();
    generateResponseWithTools.mockReset();
  });

  it("returns 400 for syntactically invalid JSON without calling the provider", async () => {
    const response = await POST(postRequest("{") as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
    expect(createOpenClawLLMProvider).not.toHaveBeenCalled();
  });

  it("returns 400 for a structurally malformed body without calling the provider", async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({ messages: [{ role: "tool", content: "{}" }] }),
      ) as never,
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toEqual(expect.stringContaining("toolCallId"));
    expect(createOpenClawLLMProvider).not.toHaveBeenCalled();
  });
});

/**
 * The gate is read once at module load, so each branch needs its own module
 * instance — same approach as `demo-limits.test.ts`, which pins the other
 * build-dependent constant in this directory.
 */
async function loadRoute(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("./route");
}

describe("examples/web /api/chat-openclaw route, per build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("answers 404 in a production build without reaching the gateway", async () => {
    const { POST: post } = await loadRoute("production");

    const response = await post(
      postRequest(
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      ) as never,
    );

    // 404, not 400: a valid body must not be told the route merely disliked it.
    expect(response.status).toBe(404);
    expect(createOpenClawLLMProvider).not.toHaveBeenCalled();
  });

  it("serves the route outside production", async () => {
    const { POST: post } = await loadRoute("development");
    generateResponse.mockResolvedValue("hello");

    const response = await post(
      postRequest(
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      ) as never,
    );

    expect(response.status).toBe(200);
    expect(createOpenClawLLMProvider).toHaveBeenCalled();
  });
});
