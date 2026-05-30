import { describe, it, expect } from "vitest";

import { createServerExtractor } from "./server-extractor";
import type { Transcript } from "./promotion-types";

describe("createServerExtractor (MVP no-op)", () => {
  it("emits no fact candidates regardless of transcript content", async () => {
    const extractor = createServerExtractor();
    const transcript: Transcript = {
      sessionId: "s1",
      scope: { userId: "u", characterId: "c" },
      startedAt: 0,
      endedAt: 1,
      turns: [{ id: "t1", role: "user", text: "I love coffee", at: 0 }],
    };

    expect(await extractor.extract(transcript)).toEqual([]);
  });
});
