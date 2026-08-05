import { describe, expect, it } from "vitest";
import { computeLipSyncRms } from "../src/lipsync-analyzer";

// Production always passes frequencyBinCount (128) from fftSize 256,
// so the speech band is [12, 76).
const BIN_COUNT = 128;

function createFrequencyData(
  energyByBin: Record<number, number>,
): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(BIN_COUNT);
  for (const [bin, value] of Object.entries(energyByBin)) {
    data[Number(bin)] = value;
  }
  return data;
}

describe("computeLipSyncRms", () => {
  it("returns 0 for silence", () => {
    expect(computeLipSyncRms(new Uint8Array(BIN_COUNT))).toBe(0);
  });

  it("ignores energy below the speech band", () => {
    const data = createFrequencyData({ 0: 255, 5: 255, 11: 255 });

    expect(computeLipSyncRms(data)).toBe(0);
  });

  it("ignores energy at or above the speech band end", () => {
    const data = createFrequencyData({ 76: 255, 100: 255, 127: 255 });

    expect(computeLipSyncRms(data)).toBe(0);
  });

  it("reacts to energy inside the speech band", () => {
    expect(computeLipSyncRms(createFrequencyData({ 12: 255 }))).toBeGreaterThan(
      0,
    );
    expect(computeLipSyncRms(createFrequencyData({ 75: 255 }))).toBeGreaterThan(
      0,
    );
  });

  it("applies the x2 gain", () => {
    // One saturated bin out of 64: sqrt(1 / 64) = 0.125, times 1.7 = 0.2125.
    expect(computeLipSyncRms(createFrequencyData({ 40: 255 }))).toBe(0.2125);
  });

  it("clamps saturated input to 1", () => {
    const data = new Uint8Array(BIN_COUNT).fill(255);

    expect(computeLipSyncRms(data)).toBe(1);
  });
});
