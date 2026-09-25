import { describe, expect, test } from "bun:test";
import { summarize } from "../bench/core/stats";

describe("benchmark sample reporting", () => {
  test("uses nearest-rank p95, keeping outliers in raw samples", () => {
    const samples = [...Array.from({ length: 20 }, () => 2), 100];
    const stats = summarize(samples);
    expect(stats.medianMs).toBe(2);
    expect(stats.p95Ms).toBe(2);
    expect(stats.maxMs).toBe(100);
    expect(stats.samples).toEqual(samples);
  });
  test("handles even samples without reordering the caller's data", () => {
    const samples = [8, 2, 4, 6];
    expect(summarize(samples).medianMs).toBe(5);
    expect(samples).toEqual([8, 2, 4, 6]);
  });
  test("rejects absent or invalid timing data", () => {
    for (const samples of [[], [Number.NaN], [Infinity], [-1]]) {
      expect(() => summarize(samples)).toThrow();
    }
  });
});
