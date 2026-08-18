import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The session cap is the one limit that differs between builds, and the
 * production value is a cost control — pin both branches so a future edit to
 * the development ergonomics cannot quietly loosen what gets deployed.
 */
async function loadLimits(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.resetModules();
  return import("./demo-limits");
}

describe("companion demo limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps the 90s session cap in production builds", async () => {
    const { REALTIME_SESSION_MAX_MS } = await loadLimits("production");
    expect(REALTIME_SESSION_MAX_MS).toBe(90_000);
  });

  it("loosens the session cap outside production, without removing it", async () => {
    const { REALTIME_SESSION_MAX_MS } = await loadLimits("development");
    expect(REALTIME_SESSION_MAX_MS).toBeGreaterThan(90_000);
    expect(Number.isFinite(REALTIME_SESSION_MAX_MS)).toBe(true);
  });

  it("pins the cost-bearing limits identically in every build", async () => {
    const prod = await loadLimits("production");
    const dev = await loadLimits("development");

    for (const key of [
      "REALTIME_MODEL",
      "REALTIME_TRANSCRIPTION_MODEL",
      "REALTIME_MAX_OUTPUT_TOKENS",
      "REALTIME_MAX_INSTRUCTIONS_CHARS",
      "REALTIME_MAX_TOOLS",
      "REALTIME_MAX_TOOLS_BYTES",
    ] as const) {
      expect(dev[key], `${key} must not differ by build`).toBe(prod[key]);
    }
  });
});
