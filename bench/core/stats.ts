export function summarize(samples: readonly number[]) {
  if (!samples.length || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("Expected finite, nonnegative samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    medianMs:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    samples: [...samples],
  };
}
