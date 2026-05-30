import * as fs from "node:fs";
import * as path from "node:path";

// This is the RUNTIME reader's DB location. Any app-side WRITER (subtask-03
// promoteSession wiring, in this or a later subtask) MUST construct its store
// with this SAME path so reads see writes. Wiring the actual write trigger is
// OUT of scope here.
//
// Unit TESTS are exempt — they pass ":memory:"/a temp file directly to
// SqliteMemoryStore, never through this helper.

export function getCompanionDbPath(): string {
  const resolved =
    process.env.COMPANION_MEMORY_DB ??
    path.join(process.cwd(), ".data", "companion-memory.db");

  // Reject ":memory:" — a misconfigured runtime should not silently lose memory.
  // The fixed fallback is always a file path, so this only fires on an explicit
  // ":memory:" env override.
  if (resolved === ":memory:") {
    throw new Error(
      "COMPANION_MEMORY_DB must be a file path, not ':memory:' — an in-memory DB would lose promoted facts between sessions",
    );
  }

  // Ensure parent dir exists so a fresh checkout with no .data/ dir doesn't
  // crash new DatabaseSync(file). recursive: true is a no-op if it exists.
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  return resolved;
}
