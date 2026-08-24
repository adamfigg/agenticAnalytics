// Tiny numeric helpers. Kept deterministic and dependency-free.
export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function pctDelta(current: number, baseline: number): number {
  if (baseline === 0) return 0;
  return +(((current - baseline) / baseline) * 100).toFixed(1);
}

// Guard against firing anomalies on tiny-traffic noise.
// Returns true only if the sample is big enough to trust a percentage move.
export function isSignificant(sampleSize: number, minSample = 30): boolean {
  return sampleSize >= minSample;
}
