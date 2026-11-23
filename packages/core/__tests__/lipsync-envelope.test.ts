import { describe, expect, it } from "vitest";
import {
  LIPSYNC_FFT_SIZE,
  createLipSyncEnvelope,
  stepLipSyncEnvelope,
} from "../src/lipsync-analyzer";

const FRAME_MS = 1000 / 60;

function level(dbfs: number): Float32Array {
  // A constant buffer's RMS is its amplitude.
  return new Float32Array(LIPSYNC_FFT_SIZE).fill(10 ** (dbfs / 20));
}

function run(
  envelope: ReturnType<typeof createLipSyncEnvelope>,
  samples: Float32Array,
  frames: number,
  deltaMs = FRAME_MS,
): number {
  let mouth = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    mouth = stepLipSyncEnvelope(envelope, samples, deltaMs);
  }
  return mouth;
}

describe("stepLipSyncEnvelope", () => {
  it("stays closed on silence", () => {
    expect(run(createLipSyncEnvelope(), level(-Infinity), 30)).toBe(0);
  });

  it("gates line noise below -50 dBFS", () => {
    expect(run(createLipSyncEnvelope(), level(-55), 30)).toBe(0);
  });

  it("opens with a ~35 ms attack instead of jumping", () => {
    const envelope = createLipSyncEnvelope();

    expect(stepLipSyncEnvelope(envelope, level(-12), FRAME_MS)).toBeCloseTo(
      1 - Math.exp(-FRAME_MS / 35),
      10,
    );
    expect(run(envelope, level(-12), 15)).toBeGreaterThan(0.99);
  });

  it("closes within a syllable gap", () => {
    const envelope = createLipSyncEnvelope();
    const open = run(envelope, level(-12), 30);

    // 100 ms of silence: six frames of the ~80 ms release.
    const closed = run(envelope, level(-Infinity), 6);

    expect(closed).toBeCloseTo(open * Math.exp(-100 / 80), 10);
    expect(closed).toBeLessThan(0.3);
  });

  it("opens a quieter syllable less than the loud one before it", () => {
    const envelope = createLipSyncEnvelope();
    expect(run(envelope, level(-12), 30)).toBeGreaterThan(0.99);
    run(envelope, level(-Infinity), 6);

    // Half the loud syllable's amplitude: 0.5^1.5 ~ 0.35 of the reference,
    // creeping up as the reference decays over the 200 ms syllable.
    const quieter = run(envelope, level(-18), 12);

    expect(quieter).toBeGreaterThan(0.3);
    expect(quieter).toBeLessThan(0.5);
  });

  it("normalizes a quiet voice to the full range", () => {
    expect(run(createLipSyncEnvelope(), level(-35), 30)).toBeGreaterThan(0.99);
  });

  it("keeps faint sound above the gate from opening fully", () => {
    // -45 dBFS sits 5 dB under the -40 dBFS reference floor.
    expect(run(createLipSyncEnvelope(), level(-45), 60)).toBeCloseTo(
      10 ** ((-5 / 20) * 1.5),
      5,
    );
  });

  it("lets the loudness reference decay back toward quieter speech", () => {
    const envelope = createLipSyncEnvelope();
    run(envelope, level(-12), 1);

    // The reference reaches a -24 dBFS voice after 2 s (12 dB at 6 dB/s).
    expect(run(envelope, level(-24), 180)).toBeGreaterThan(0.99);
  });

  it("leaves the envelope untouched for an empty window", () => {
    const envelope = createLipSyncEnvelope();
    const open = run(envelope, level(-12), 30);

    expect(stepLipSyncEnvelope(envelope, new Float32Array(0), FRAME_MS)).toBe(
      open,
    );
    expect(Number.isNaN(envelope.peak)).toBe(false);
    expect(stepLipSyncEnvelope(envelope, level(-12), FRAME_MS)).toBeGreaterThan(
      open,
    );
  });

  it("does not depend on the frame rate", () => {
    const at60 = createLipSyncEnvelope();
    const at120 = createLipSyncEnvelope();

    run(at60, level(-12), 3);
    run(at120, level(-12), 6, FRAME_MS / 2);
    const closing60 = run(at60, level(-Infinity), 3);
    const closing120 = run(at120, level(-Infinity), 6, FRAME_MS / 2);

    expect(closing120).toBeCloseTo(closing60, 10);
  });
});
