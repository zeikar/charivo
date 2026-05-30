import { NextRequest, NextResponse } from "next/server";
import { getCompanionStore } from "@/memory/store-singleton";
import { createFakeEmbedder } from "@/memory/embedding";
import { createServerExtractor } from "@/memory/server-extractor";
import { promoteSession } from "@/memory/promote";
import type { Turn } from "@/memory/promotion-types";

/** Validate one transcript turn at the external request boundary. */
function isTurn(value: unknown): value is Turn {
  const t = value as {
    id?: unknown;
    role?: unknown;
    text?: unknown;
    at?: unknown;
  };
  return (
    typeof t?.id === "string" &&
    (t.role === "user" || t.role === "assistant") &&
    typeof t.text === "string" &&
    typeof t.at === "number"
  );
}

/**
 * Write path: turn a (checkpointed or finished) session transcript into durable
 * memory. The client posts the cumulative transcript at checkpoints and on
 * session end; promoteSession is idempotent, so cumulative resends are safe.
 */
export async function POST(request: NextRequest) {
  // Parse body in its own try/catch so malformed JSON returns a clean 400.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const raw = body as {
      scope?: { userId?: unknown; characterId?: unknown };
      sessionId?: unknown;
      startedAt?: unknown;
      endedAt?: unknown;
      turns?: unknown;
      finalize?: unknown;
    };
    const { scope } = raw;

    if (
      typeof scope?.userId !== "string" ||
      scope.userId === "" ||
      typeof scope?.characterId !== "string" ||
      scope.characterId === ""
    ) {
      return NextResponse.json(
        { error: "scope.userId and scope.characterId are required" },
        { status: 400 },
      );
    }
    if (typeof raw.sessionId !== "string" || raw.sessionId === "") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }
    if (typeof raw.startedAt !== "number") {
      return NextResponse.json(
        { error: "startedAt must be a number" },
        { status: 400 },
      );
    }
    if (raw.endedAt !== null && typeof raw.endedAt !== "number") {
      return NextResponse.json(
        { error: "endedAt must be a number or null" },
        { status: 400 },
      );
    }
    if (!Array.isArray(raw.turns) || !raw.turns.every(isTurn)) {
      return NextResponse.json(
        { error: "turns must be an array of { id, role, text, at }" },
        { status: 400 },
      );
    }
    if (typeof raw.finalize !== "boolean") {
      return NextResponse.json(
        { error: "finalize must be a boolean" },
        { status: 400 },
      );
    }

    const result = await promoteSession({
      transcript: {
        sessionId: raw.sessionId,
        scope: { userId: scope.userId, characterId: scope.characterId },
        startedAt: raw.startedAt,
        endedAt: raw.endedAt,
        turns: raw.turns as Turn[],
      },
      store: getCompanionStore(),
      // Fake/real embedder seam — deterministic, no network (MVP).
      embedder: createFakeEmbedder(),
      // No-op fact extractor in the MVP; relationship + session still persist.
      extractor: createServerExtractor(),
      now: Date.now(),
      finalize: raw.finalize,
    });

    return NextResponse.json({ result });
  } catch (err) {
    console.error("Memory promotion error:", err);
    return NextResponse.json(
      { error: "Failed to promote session", details: String(err) },
      { status: 500 },
    );
  }
}
