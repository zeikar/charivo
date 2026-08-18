import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPENAI_REALTIME_AGENTS_ADAPTER } from "@charivo/core";

const createSession = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAIRealtimeProvider: vi.fn(() => ({
    createSession,
  })),
}));

import { POST } from "./route";
import {
  REALTIME_MAX_INSTRUCTIONS_CHARS,
  REALTIME_MAX_OUTPUT_TOKENS,
  REALTIME_MAX_TOOLS,
  REALTIME_MAX_TOOLS_BYTES,
  REALTIME_MODEL,
  REALTIME_TRANSCRIPTION_MODEL,
} from "../demo-limits";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/realtime", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/companion /api/realtime route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    createSession.mockReset();
    createSession.mockResolvedValue({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
  });

  it("forwards the selected adapter to the realtime provider", async () => {
    const response = await POST(
      postRequest({
        adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
        transport: "webrtc",
        session: { provider: "openai" },
      }) as never,
    );

    expect(createSession).toHaveBeenCalledWith({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      session: {
        provider: "openai",
        model: REALTIME_MODEL,
        maxTokens: REALTIME_MAX_OUTPUT_TOKENS,
      },
      sdpOffer: undefined,
    });
    await expect(response.json()).resolves.toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "client-secret",
    });
  });

  it("pins the model server-side and ignores the caller's choice", async () => {
    await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          model: "gpt-4o-realtime-preview",
          maxTokens: 1_000_000,
        },
      }) as never,
    );

    const session = createSession.mock.calls[0][0].session;
    expect(session.model).toBe(REALTIME_MODEL);
    expect(session.maxTokens).toBe(REALTIME_MAX_OUTPUT_TOKENS);
  });

  it("pins the transcription model while keeping transcription enabled", async () => {
    await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          inputAudioTranscription: { model: "whisper-1" },
        },
      }) as never,
    );

    expect(
      createSession.mock.calls[0][0].session.inputAudioTranscription,
    ).toEqual({ enabled: true, model: REALTIME_TRANSCRIPTION_MODEL });
  });

  /**
   * `enabled: false` outranks `model` downstream, so forwarding the caller's
   * flag would let a request silence the transcripts the memory write path is
   * built on. Asking for transcription at all has to mean enabled.
   */
  it("ignores an enabled:false flag on a transcription request", async () => {
    await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          inputAudioTranscription: { enabled: false, model: "whisper-1" },
        },
      }) as never,
    );

    expect(
      createSession.mock.calls[0][0].session.inputAudioTranscription,
    ).toEqual({ enabled: true, model: REALTIME_TRANSCRIPTION_MODEL });
  });

  it("leaves transcription off when the caller does not ask for it", async () => {
    await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "openai" },
      }) as never,
    );

    expect(
      createSession.mock.calls[0][0].session.inputAudioTranscription,
    ).toBeUndefined();
  });

  it("drops a voice the caller supplies, since the demo sends none", async () => {
    await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "openai", voice: "verse" },
      }) as never,
    );

    expect(createSession.mock.calls[0][0].session.voice).toBeUndefined();
  });

  it("rejects instructions longer than the demo cap", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          instructions: "x".repeat(REALTIME_MAX_INSTRUCTIONS_CHARS + 1),
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects more tools than the demo cap", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          tools: Array.from({ length: REALTIME_MAX_TOOLS + 1 }, () => ({
            type: "function",
            name: "noop",
            description: "",
            parameters: { type: "object", properties: {} },
          })),
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a toolChoice outside the accepted set", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "openai", toolChoice: "whatever-i-want" },
      }) as never,
    );

    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("measures the tool budget in UTF-8 bytes, not UTF-16 code units", async () => {
    // Each of these is 1 UTF-16 code unit but 3 UTF-8 bytes, so a payload that
    // looks legal by .length is over the real wire budget.
    const filler = "一".repeat(REALTIME_MAX_TOOLS_BYTES - 200);
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: {
          provider: "openai",
          tools: [
            {
              type: "function",
              name: "noop",
              description: filler,
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      }) as never,
    );

    expect(filler.length).toBeLessThan(REALTIME_MAX_TOOLS_BYTES);
    expect(response.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("still rejects a non-openai provider", async () => {
    const response = await POST(
      postRequest({
        transport: "webrtc",
        session: { provider: "elevenlabs" },
      }) as never,
    );

    expect(response.status).toBe(501);
    expect(createSession).not.toHaveBeenCalled();
  });
});
