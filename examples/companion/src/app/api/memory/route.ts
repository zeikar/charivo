import { NextRequest, NextResponse } from "next/server";
import { createFakeEmbedder } from "@/memory/embedding";
import { getCompanionStore } from "@/memory/store-singleton";
import { buildMemoryInstructionBlock } from "@/memory/build-memory-block";

export async function POST(request: NextRequest) {
  // Parse body in its own try/catch so malformed JSON returns a clean 400
  // before any other logic runs.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Validate at the external parse boundary.
    const raw = body as {
      scope?: { userId?: unknown; characterId?: unknown };
      query?: unknown;
    };
    const { scope, query } = raw;

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

    if (query !== undefined && typeof query !== "string") {
      return NextResponse.json(
        { error: "query must be a string" },
        { status: 400 },
      );
    }

    // Fake/real embedder seam — no real query embedder is wired server-side yet
    // (deterministic, no network), consistent with the MVP.
    const embedder = createFakeEmbedder();
    const queryEmbedding = query ? await embedder.embed(query) : undefined;

    const instructionsBlock = await buildMemoryInstructionBlock({
      store: getCompanionStore(),
      scope: { userId: scope.userId, characterId: scope.characterId },
      now: Date.now(),
      queryEmbedding,
    });

    return NextResponse.json({ instructionsBlock });
  } catch (err) {
    console.error("Memory retrieval error:", err);
    return NextResponse.json(
      {
        error: "Failed to build memory block",
        details: String(err),
      },
      { status: 500 },
    );
  }
}
