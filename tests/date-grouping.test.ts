import { describe, expect, test } from "bun:test";

import {
  type DateGroupMode,
  dateGroupValue,
  isYmd,
  type RelativeLabels,
  toYmd,
} from "../src";

// toYmd is the single normalization point that lets grouping and filtering stay
// correct whether a value is a clean date, a full datetime, or a Date object —
// the FIRST/LAST_OCCURENCE columns ship datetimes in some environments, and we
// only ever care about the calendar day.
describe("toYmd", () => {
  test("passes through a clean date string", () => {
    expect(toYmd("2026-03-26")).toBe("2026-03-26");
  });
  test("strips the time off a datetime string", () => {
    expect(toYmd("2025-10-24 10:14:36.000")).toBe("2025-10-24");
    expect(toYmd("2026-06-08T14:42:55.000Z")).toBe("2026-06-08");
  });
  // The rule is the LOCAL calendar day, in every timezone the suite may run in.
  // `toISOString().slice(0, 10)` is the UTC day, which is a different day for
  // most of the clock: local midnight is the previous day east of Greenwich,
  // and a local evening is already tomorrow west of it. `relativeBucket` and
  // ExcelJS both reason in local time, so UTC here put them a day apart.
  test("handles Date objects via their LOCAL calendar day", () => {
    expect(toYmd(new Date(2026, 5, 8, 14, 42, 55))).toBe("2026-06-08");
  });
  test("a Date at local midnight keeps its own day", () => {
    expect(toYmd(new Date(2026, 5, 8))).toBe("2026-06-08");
    expect(toYmd(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
  test("a Date late in the local evening has not rolled over yet", () => {
    expect(toYmd(new Date(2026, 5, 8, 23, 30))).toBe("2026-06-08");
  });
  test("round-trips every local calendar day across a DST boundary", () => {
    for (let day = 24; day <= 31; day++) {
      const date = new Date(2026, 2, day);
      expect(toYmd(date)).toBe(`2026-03-${String(day).padStart(2, "0")}`);
    }
  });
  test("returns empty string for missing or unparseable values", () => {
    expect(toYmd(null)).toBe("");
    expect(toYmd(undefined)).toBe("");
    expect(toYmd("not a date")).toBe("");
    expect(toYmd(new Date("nope"))).toBe("");
  });
});

describe("isYmd", () => {
  test("accepts only a bare YYYY-MM-DD", () => {
    expect(isYmd("2026-03-26")).toBe(true);
    expect(isYmd("2026-03-26T00:00")).toBe(false);
    expect(isYmd("")).toBe(false);
  });
});

const LABELS: RelativeLabels = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  thisMonth: "This month",
  older: "Older",
  none: "—",
};

describe("dateGroupValue — exact mode", () => {
  const now = new Date(2026, 5, 24);
  const exact: DateGroupMode = "exact";

  test("keys and labels on the calendar day so days sort chronologically", () => {
    // sortKey === label === YYYY-MM-DD; lexical sort of ISO dates is
    // chronological, which is what buildFlatItems relies on.
    expect(dateGroupValue("2026-03-26", exact, now, LABELS)).toEqual({
      sortKey: "2026-03-26",
      label: "2026-03-26",
    });
  });

  test("collapses a datetime to its day so same-day rows share a group", () => {
    expect(dateGroupValue("2026-03-26T09:00:00Z", exact, now, LABELS)).toEqual({
      sortKey: "2026-03-26",
      label: "2026-03-26",
    });
  });

  test("missing dates fall into one 'none' group that sorts last", () => {
    const { sortKey, label } = dateGroupValue(null, exact, now, LABELS);
    expect(label).toBe("—");
    expect(sortKey > "2026-12-31").toBe(true);
  });
});

// Relative buckets must order by recency (Today → Older), NOT by label text —
// hence numeric sortKeys. now is fixed to Wed 2026-06-24 (Monday-started week
// begins 2026-06-22) so bucket boundaries are deterministic.
describe("dateGroupValue — relative mode", () => {
  const now = new Date(2026, 5, 24); // Wed 24 Jun 2026
  const rel: DateGroupMode = "relative";
  const v = (d: string) => dateGroupValue(d, rel, now, LABELS);

  test("buckets each window with a recency-ordered sortKey", () => {
    expect(v("2026-06-24")).toEqual({ sortKey: "0", label: "Today" });
    expect(v("2026-06-23")).toEqual({ sortKey: "1", label: "Yesterday" });
    expect(v("2026-06-22")).toEqual({ sortKey: "2", label: "This week" });
    expect(v("2026-06-05")).toEqual({ sortKey: "3", label: "This month" });
    expect(v("2026-03-15")).toEqual({ sortKey: "4", label: "Older" });
  });

  test("sortKeys order Today before Older regardless of label spelling", () => {
    expect(v("2026-06-24").sortKey < v("2026-03-15").sortKey).toBe(true);
  });
});
