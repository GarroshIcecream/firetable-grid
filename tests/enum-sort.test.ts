import { describe, expect, test } from "bun:test";

import { enumIndexComparator } from "../src";

// An ordered enum scale, declared best → worst.
const ORDER = [
  "DEMAND_ALERT_VERY_HIGH",
  "DEMAND_ALERT_HIGH",
  "DEMAND_ALERT_STABLE",
  "DEMAND_ALERT_LOW",
  "DEMAND_ALERT_VERY_LOW",
  "DEMAND_ALERT_NA",
];

describe("enumIndexComparator", () => {
  const cmp = enumIndexComparator(ORDER);

  test("orders by declaration index, not alphabetically", () => {
    // VERY_HIGH (idx 0) sorts before HIGH (idx 1) ascending — the opposite of
    // alphabetical order, where "HIGH" < "VERY_HIGH". This is the whole point:
    // High Demand must lead with VERY_HIGH, not with HIGH.
    expect(cmp("DEMAND_ALERT_VERY_HIGH", "DEMAND_ALERT_HIGH")).toBeLessThan(0);
    expect(cmp("DEMAND_ALERT_HIGH", "DEMAND_ALERT_VERY_HIGH")).toBeGreaterThan(
      0,
    );
    expect(cmp("DEMAND_ALERT_HIGH", "DEMAND_ALERT_HIGH")).toBe(0);
  });

  test("unknown / empty values sort last", () => {
    expect(cmp("UNKNOWN", "DEMAND_ALERT_NA")).toBeGreaterThan(0);
    expect(cmp(null, "DEMAND_ALERT_HIGH")).toBeGreaterThan(0);
  });
});
