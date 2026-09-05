import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapTranscription } from "./bootstrap-transcription";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("bootstrapTranscription", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // The regression this module exists for: a 200 that carries a minted
  // WebSocket credential but fails `pick` on another field (a missing/non-string
  // `url`) must not let that credential reach the thrown error's message.
  it("keeps a credential out of the error when an ok response is otherwise unusable", async () => {
    const token = "ephemeral-secret-token-value";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { token })) as typeof fetch;

    const pick = (payload: Record<string, unknown>) =>
      typeof payload.url === "string" && typeof payload.token === "string"
        ? { url: payload.url, token: payload.token }
        : null;

    const error: unknown = await bootstrapTranscription(
      "/api/example",
      {},
      pick,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(token);
  });

  it("still reports the response body when the response was not ok", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("upstream exploded", { status: 500 }),
      ) as typeof fetch;

    const pick = () => null;

    await expect(
      bootstrapTranscription("/api/example", {}, pick),
    ).rejects.toThrow(/upstream exploded/);
  });

  it("resolves with what pick returns when the response is ok and usable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { url: "wss://example.test", token: "t" }),
      ) as typeof fetch;

    const pick = (payload: Record<string, unknown>) =>
      typeof payload.url === "string" && typeof payload.token === "string"
        ? { url: payload.url, token: payload.token }
        : null;

    await expect(
      bootstrapTranscription("/api/example", {}, pick),
    ).resolves.toEqual({ url: "wss://example.test", token: "t" });
  });
});
