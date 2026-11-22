import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

function post(body: string): NextRequest {
  return new Request("http://127.0.0.1/api/tts", {
    method: "POST",
    body,
  }) as unknown as NextRequest;
}

describe("POST /api/tts body validation", () => {
  it.each(["null", "[]", '"hi"', "not json"])(
    "answers 400 for %s",
    async (raw) => {
      const response = await POST(post(raw));
      expect(response.status).toBe(400);
    },
  );
});
