import { beforeEach, describe, expect, it, vi } from "vitest";

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
