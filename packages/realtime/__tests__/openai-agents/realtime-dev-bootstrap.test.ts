import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENAI_REALTIME_AGENTS_ADAPTER,
  CharivoProviderError,
  CharivoStateError,
} from "@charivo/core";
import type { RealtimeSessionRequest } from "@charivo/core";
import { getOpenAIRealtimeAgentsBootstrap } from "../../src/openai-agents/bootstrap";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const request: RealtimeSessionRequest = {
  transport: "webrtc",
  session: {
    model: "gpt-4o-realtime-preview",
    voice: "nova",
  },
};

function makeFetchOk(payload: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

function makeFetchNonOk(errorBody: string): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    text: async () => errorBody,
    json: async () => {
      throw new Error("not used");
    },
  })) as unknown as typeof fetch;
}

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

describe("getOpenAIRealtimeAgentsBootstrap — apiKey (dev-bootstrap) path", () => {
  it("returns clientSecret for payload shape { value }", async () => {
    globalThis.fetch = makeFetchOk({ value: "ek_abc" });

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { apiKey: "sk-test" },
      request,
    );

    expect(result).toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "ek_abc",
    });
  });

  it("returns clientSecret for payload shape { client_secret: string }", async () => {
    globalThis.fetch = makeFetchOk({ client_secret: "ek_string" });

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { apiKey: "sk-test" },
      request,
    );

    expect(result).toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "ek_string",
    });
  });

  it("returns clientSecret for payload shape { client_secret: { value } }", async () => {
    globalThis.fetch = makeFetchOk({ client_secret: { value: "ek_nested" } });

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { apiKey: "sk-test" },
      request,
    );

    expect(result).toEqual({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "ek_nested",
    });
  });

  it("throws CharivoProviderError when fetch responds non-ok", async () => {
    globalThis.fetch = makeFetchNonOk("bad key");

    await expect(
      getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request),
    ).rejects.toThrow(CharivoProviderError);

    await expect(
      getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request),
    ).rejects.toThrow("bad key");
  });

  it("throws CharivoProviderError when payload has no recognizable secret field", async () => {
    globalThis.fetch = makeFetchOk({});

    await expect(
      getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request),
    ).rejects.toThrow(CharivoProviderError);
  });

  it("throws CharivoProviderError (not SyntaxError) when json() rejects", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("bad json");
      },
      text: async () => "bad json",
    })) as unknown as typeof fetch;

    await expect(
      getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request),
    ).rejects.toThrow(CharivoProviderError);

    await expect(
      getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request),
    ).rejects.not.toThrow(SyntaxError);
  });

  it("calls fetch with the client-secrets URL, correct auth, and session body", async () => {
    const mockFetch = makeFetchOk({ value: "ek_body_check" });
    globalThis.fetch = mockFetch;

    await getOpenAIRealtimeAgentsBootstrap({ apiKey: "sk-test" }, request);

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);

    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe(CLIENT_SECRETS_URL);

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      session: { model?: string; audio?: { output?: { voice?: string } } };
    };
    // The session mapper places model at top-level and voice inside audio.output
    expect(body.session.model).toBe("gpt-4o-realtime-preview");
    expect(body.session.audio?.output?.voice).toBe("nova");
  });
});

describe("getOpenAIRealtimeAgentsBootstrap — precedence", () => {
  it("uses sessionBootstrap callback when provided alongside apiKey; fetch is not called", async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const sessionBootstrap = vi.fn(async () => ({
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc" as const,
      clientSecret: "from-bootstrap",
    }));

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { sessionBootstrap, apiKey: "sk-test" },
      request,
    );

    expect(result.clientSecret).toBe("from-bootstrap");
    expect(sessionBootstrap).toHaveBeenCalledWith(request);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses apiEndpoint POST path when provided alongside apiKey; client-secrets URL is not called", async () => {
    const validBootstrap = {
      adapter: OPENAI_REALTIME_AGENTS_ADAPTER,
      transport: "webrtc",
      clientSecret: "from-endpoint",
    };
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => validBootstrap,
      text: async () => JSON.stringify(validBootstrap),
    })) as unknown as typeof fetch;
    globalThis.fetch = mockFetch;

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { apiEndpoint: "https://my-server.example/session", apiKey: "sk-test" },
      request,
    );

    expect(result.clientSecret).toBe("from-endpoint");

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const [url] = calls[0] as [string];
    expect(url).not.toBe(CLIENT_SECRETS_URL);
    expect(url).toBe("https://my-server.example/session");
  });

  it("uses the dev-bootstrap minting path when only apiKey is provided", async () => {
    globalThis.fetch = makeFetchOk({ value: "ek_only_key" });

    const result = await getOpenAIRealtimeAgentsBootstrap(
      { apiKey: "sk-test" },
      request,
    );

    expect(result.clientSecret).toBe("ek_only_key");
  });

  it("throws CharivoStateError naming all three options when none are provided", async () => {
    await expect(getOpenAIRealtimeAgentsBootstrap({}, request)).rejects.toThrow(
      CharivoStateError,
    );

    await expect(getOpenAIRealtimeAgentsBootstrap({}, request)).rejects.toThrow(
      /sessionBootstrap/,
    );

    await expect(getOpenAIRealtimeAgentsBootstrap({}, request)).rejects.toThrow(
      /apiEndpoint/,
    );

    await expect(getOpenAIRealtimeAgentsBootstrap({}, request)).rejects.toThrow(
      /apiKey/,
    );
  });
});
