import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import {
  buildCsvString,
  buildExportFilename,
  col,
  dateGroupValue,
  exportCellText,
  PLAIN_EXPORT_CONTEXT,
  type RelativeLabels,
  resolveCellValue,
  resolveExportCell,
  toLocalYmd,
  toYmd,
  ymdToLocalDate,
} from "../src";

// A date value's calendar day is LOCAL, everywhere in the package. These
// assertions are written to hold in ANY timezone the suite runs in, which is
// what makes them a real guard: the UTC-based `toISOString().slice(0, 10)`
// they replaced fails them east of Greenwich (local midnight reads as
// yesterday) and west of it (a local evening reads as tomorrow).

const dateCol = col<{ day: unknown }>({
  id: "day",
  label: "Day",
  type: ColumnTypes.DATE,
});

const labels: RelativeLabels = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  thisMonth: "This month",
  older: "Older",
  none: "None",
};

describe("toLocalYmd / ymdToLocalDate", () => {
  test("round-trip through a Date preserves the calendar day", () => {
    for (const ymd of [
      "2026-01-01",
      "2026-03-29",
      "2026-06-08",
      "2026-12-31",
    ]) {
      expect(toLocalYmd(ymdToLocalDate(ymd) as Date)).toBe(ymd);
    }
  });

  test("ymdToLocalDate lands on local midnight, not UTC midnight", () => {
    const date = ymdToLocalDate("2026-06-08") as Date;
    expect(date.getHours()).toBe(0);
    expect(date.getDate()).toBe(8);
  });

  test("ymdToLocalDate rejects anything that is not a bare YYYY-MM-DD", () => {
    expect(ymdToLocalDate("")).toBeNull();
    expect(ymdToLocalDate("2026-06")).toBeNull();
    expect(ymdToLocalDate("not a date")).toBeNull();
  });
});

describe("a date exports as the day the grid groups and filters it under", () => {
  // The bug this pins: the three paths disagreed by a day. `toYmd` (filter +
  // grouping) read a Date in UTC, `exportCellText` (CSV) read it in UTC, and
  // ExcelJS wrote it at its local wall clock.
  test("a Date at local midnight reports the same day to all three", () => {
    const midnight = new Date(2026, 5, 8);
    const cell = resolveExportCell({ day: midnight }, dateCol, {
      colorsFor: () => undefined,
      enumLabel: () => null,
      currencySymbol: "€",
    });

    expect(toYmd(midnight)).toBe("2026-06-08");
    expect(exportCellText(cell)).toBe("2026-06-08");
    // What ExcelJS will serialize: it preserves the local wall clock, so the
    // workbook shows whatever local day this Date names.
    expect(toLocalYmd(cell.value as Date)).toBe("2026-06-08");
  });

  test("a date-only string is not reinterpreted as UTC midnight", () => {
    const cell = resolveExportCell({ day: "2026-06-08" }, dateCol, {
      colorsFor: () => undefined,
      enumLabel: () => null,
      currencySymbol: "€",
    });
    // `new Date("2026-06-08")` is UTC midnight, which ExcelJS then writes at
    // the local wall clock — the 7th, anywhere west of Greenwich.
    expect(toLocalYmd(cell.value as Date)).toBe("2026-06-08");
    expect(exportCellText(cell)).toBe("2026-06-08");
    expect(toYmd("2026-06-08")).toBe("2026-06-08");
  });

  test("an instant keeps the literal prefix the filter path keys off", () => {
    const raw = "2026-06-08T23:45:00.000Z";
    const cell = resolveExportCell({ day: raw }, dateCol, {
      colorsFor: () => undefined,
      enumLabel: () => null,
      currencySymbol: "€",
    });
    expect(exportCellText(cell)).toBe(toYmd(raw));
    expect(exportCellText(cell)).toBe("2026-06-08");
  });

  test("the CSV column agrees with the grouping label for the same value", () => {
    const now = new Date(2026, 5, 8, 12);
    const today = new Date(2026, 5, 8);
    expect(dateGroupValue(today, "relative", now, labels).label).toBe("Today");
    expect(dateGroupValue(today, "exact", now, labels).sortKey).toBe(
      resolveCellValue({ day: today }, dateCol),
    );
  });

  test("a whole local month of days survives the CSV round trip", () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({
      day: new Date(2026, 2, i + 1),
    }));
    const csv = buildCsvString(rows, [dateCol]);
    const body = csv.split("\r\n").slice(1);
    body.forEach((line, i) => {
      expect(line).toBe(`2026-03-${String(i + 1).padStart(2, "0")}`);
    });
  });
});

describe("buildExportFilename", () => {
  test("stamps the local calendar day", () => {
    const name = buildExportFilename({
      prefix: "report",
      date: new Date(2026, 5, 8),
    });
    expect(name).toBe("report_2026-06-08.csv");
  });
});

// The CSV text path takes a shortcut past `resolveExportCell`'s Date, because
// building one only to format it back is 12x the cost of reading the day
// string. These pin every shape that shortcut must NOT change - written
// against the original behaviour, so they are the proof the shortcut is exact.
describe("the CSV date shortcut is behaviour-preserving", () => {
  type Row = { when: unknown; label?: string };
  const dateCol = col<Row>({
    id: "when",
    label: "When",
    type: ColumnTypes.DATE,
  });

  const text = (raw: unknown) => resolveCellValue({ when: raw }, dateCol);

  test("a bare YYYY-MM-DD comes back unchanged", () => {
    expect(text("2026-03-15")).toBe("2026-03-15");
  });

  test("an instant keeps its literal date prefix", () => {
    // Not reinterpreted into the local day of that instant - the filter and
    // grouping paths key off the literal prefix, and the file must agree.
    expect(text("2026-06-08T14:42:55.000Z")).toBe("2026-06-08");
  });

  test("a Date object reports its LOCAL calendar day", () => {
    const d = new Date(2026, 2, 15, 23, 30);
    expect(text(d)).toBe(toLocalYmd(d));
    expect(text(d)).toBe("2026-03-15");
  });

  test("null and undefined export as empty", () => {
    expect(text(null)).toBe("");
    expect(text(undefined)).toBe("");
  });

  test("a string with no YYYY-MM-DD prefix still goes through the platform parser", () => {
    // The shortcut must decline this one: `toYmd` returns "" and the original
    // path falls back to `new Date(raw)` so a locale format still exports.
    const parsed = text("Sep 20, 2026");
    expect(parsed).toBe(toLocalYmd(new Date("Sep 20, 2026")));
    expect(parsed).not.toBe("");
  });

  test("an unparseable string exports as empty, not as garbage", () => {
    expect(text("not a date at all")).toBe("");
  });

  test("labelKey still wins over date formatting", () => {
    // `resolveExportCell` checks labelKey BEFORE the date branch, so the
    // shortcut has to decline whenever a date column carries one.
    const labelled = col<Row>({
      id: "when",
      label: "When",
      type: ColumnTypes.DATE,
      labelKey: "label",
    });
    expect(
      resolveCellValue({ when: "2026-03-15", label: "Release day" }, labelled),
    ).toBe("Release day");
  });

  test("the shortcut agrees with resolveExportCell for every day of a month", () => {
    for (let day = 1; day <= 31; day++) {
      const ymd = `2026-01-${String(day).padStart(2, "0")}`;
      expect(text(ymd)).toBe(
        exportCellText(
          resolveExportCell({ when: ymd }, dateCol, PLAIN_EXPORT_CONTEXT),
        ),
      );
    }
  });
});
