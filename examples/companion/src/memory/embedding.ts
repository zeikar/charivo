import type { EmbeddingAdapter } from "./types";

// Fixed dimension count — not configurable (YAGNI).
const DIMENSIONS = 16;

/** Deterministic rolling hash of a string into [0, DIMENSIONS). */
function bucketOf(token: string): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    // djb2-style: h = h * 31 + charCode, kept in 32-bit integer range.
    h = (Math.imul(h, 31) + token.charCodeAt(i)) | 0;
  }
  // Shift to unsigned before mod so negative values land in [0, DIMENSIONS).
  return ((h >>> 0) % DIMENSIONS) as number;
}

/** L2-normalize a vector in-place. Zero vectors are left as-is (all zeros, no NaN). */
function l2Normalize(v: number[]): void {
  let sum = 0;
  for (const x of v) sum += x * x;
  if (sum === 0) return; // zero vector — leave untouched, no division
  const norm = Math.sqrt(sum);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
}

class FakeEmbedder implements EmbeddingAdapter {
  readonly dimensions: number = DIMENSIONS;

  embed(text: string): Promise<number[]> {
    const vec = new Array<number>(DIMENSIONS).fill(0);

    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      vec[bucketOf(token)] += 1;
    }

    l2Normalize(vec);
    return Promise.resolve(vec);
  }
}

export function createFakeEmbedder(): EmbeddingAdapter {
  return new FakeEmbedder();
}
