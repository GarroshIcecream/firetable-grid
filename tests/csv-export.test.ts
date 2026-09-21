import { describe, expect, test } from "bun:test";
import type { RowData } from "@tanstack/react-table";
import { ColumnTypes } from "../examples/column-types";
import {
  buildCsvString,
  buildExportFilename,
  col,
  escapeCsvCell,
  resolveCellValue,
  type SchemaColumn,
  selectExportColumns,
  sortRowsForExport,
} from "../src";

type Row = {
  adId: string;
  make: string | null;
  year: number | null;
  priceWithVat: number | null;
  firstOccurence: string | null;
  notes: string | null;
};

function buildColumns(): SchemaColumn<Row>[] {
  return [
    col<Row>({
      id: "rowIndex",
      label: "#",
      type: ColumnTypes.INDEX,
      manageable: false,
      accessorKey: undefined,
    }),
    col<Row>({
      id: "make",
      label: "Make",
      type: ColumnTypes.TEXT,
    }),
    col<Row>({
      id: "year",
      label: "Year",
      type: ColumnTypes.RAW_NUMBER,
    }),
    col<Row>({
      id: "priceWithVat",
      label: "Price",
      type: ColumnTypes.CURRENCY,
    }),
    col<Row>({
      id: "firstOccurence",
      label: "First Seen",
      type: ColumnTypes.DATE,
    }),
    col<Row>({
      id: "notes",
      label: "Notes",
      type: ColumnTypes.TEXT,
    }),
    col<Row>({
      id: "deltaSellRec",
      label: "Delta",
      type: ColumnTypes.TREND,
      accessorKey: undefined,
    }),
    col<Row>({
      id: "aiChat",
      label: "AI",
      type: ColumnTypes.LINK,
      exportable: false,
    }),
  ];
}

const SAMPLE_ROWS: Row[] = [
  {
    adId: "a",
    make: "BMW",
    year: 2020,
    priceWithVat: 25000,
    firstOccurence: "2024-03-15T10:30:00.000Z",
    notes: "has, comma",
  },
  {
    adId: "b",
    make: "Audi",
    year: null,
    priceWithVat: null,
    firstOccurence: null,
    notes: null,
  },
  {
    adId: "c",
    make: "Mercedes",
    year: 2021,
    priceWithVat: 35000,
    firstOccurence: "2024-01-02T00:00:00.000Z",
    notes: "umlauts: Größe",
  },
];

// ---------------------------------------------------------------------------
// escapeCsvCell
// ---------------------------------------------------------------------------

describe("escapeCsvCell", () => {
  test("returns plain strings unchanged", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell("123")).toBe("123");
    expect(escapeCsvCell("")).toBe("");
  });

  test("quotes values containing commas", () => {
    expect(escapeCsvCell("a, b")).toBe('"a, b"');
  });

  test("quotes values containing newlines", () => {
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
    expect(escapeCsvCell("a\r\nb")).toBe('"a\r\nb"');
  });

  test("doubles internal double-quotes and wraps in quotes", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

// ---------------------------------------------------------------------------
// resolveCellValue
// ---------------------------------------------------------------------------

function findCol<T extends RowData>(
  cols: SchemaColumn<T>[],
  id: string,
): SchemaColumn<T> {
  const match = cols.find((c) => c.id === id);
  if (!match) throw new Error(`column ${id} not in test fixture`);
  return match;
}

describe("resolveCellValue", () => {
  const cols = buildColumns();
  const yearCol = findCol(cols, "year");
  const dateCol = findCol(cols, "firstOccurence");
  const notesCol = findCol(cols, "notes");
  const priceCol = findCol(cols, "priceWithVat");

  test("emits empty string for null values", () => {
    expect(resolveCellValue(SAMPLE_ROWS[1], yearCol)).toBe("");
    expect(resolveCellValue(SAMPLE_ROWS[1], priceCol)).toBe("");
    expect(resolveCellValue(SAMPLE_ROWS[1], dateCol)).toBe("");
  });

  test("emits raw numbers as plain digit strings (no thousands separator)", () => {
    expect(resolveCellValue(SAMPLE_ROWS[0], yearCol)).toBe("2020");
    expect(resolveCellValue(SAMPLE_ROWS[0], priceCol)).toBe("25000");
  });

  test("truncates ISO timestamps to YYYY-MM-DD for date columns", () => {
    expect(resolveCellValue(SAMPLE_ROWS[0], dateCol)).toBe("2024-03-15");
    expect(resolveCellValue(SAMPLE_ROWS[2], dateCol)).toBe("2024-01-02");
  });

  test("preserves text values verbatim (escaping happens later)", () => {
    expect(resolveCellValue(SAMPLE_ROWS[0], notesCol)).toBe("has, comma");
    expect(resolveCellValue(SAMPLE_ROWS[2], notesCol)).toBe("umlauts: Größe");
  });
});

// ---------------------------------------------------------------------------
// selectExportColumns
// ---------------------------------------------------------------------------

describe("selectExportColumns", () => {
  const cols = buildColumns();

  test("respects column order", () => {
    const out = selectExportColumns(
      cols,
      ["year", "make", "priceWithVat", "firstOccurence", "notes"],
      {},
      SAMPLE_ROWS,
    );
    expect(out.map((c) => c.id)).toEqual([
      "year",
      "make",
      "priceWithVat",
      "firstOccurence",
      "notes",
    ]);
  });

  test("hides columns marked invisible", () => {
    const out = selectExportColumns(
      cols,
      ["make", "year", "priceWithVat", "firstOccurence", "notes"],
      { year: false, firstOccurence: false, notes: false },
      SAMPLE_ROWS,
    );
    expect(out.map((c) => c.id)).toEqual(["make", "priceWithVat"]);
  });

  test("skips non-manageable + computed columns", () => {
    // rowIndex is non-manageable; deltaSellRec is a computed column whose
    // accessor lookup is `undefined` on every row. Both must be filtered
    // out so the CSV doesn't carry decorative or empty-by-design columns.
    const out = selectExportColumns(
      cols,
      [
        "rowIndex",
        "make",
        "deltaSellRec",
        "year",
        "priceWithVat",
        "firstOccurence",
        "notes",
      ],
      { priceWithVat: false, firstOccurence: false, notes: false },
      SAMPLE_ROWS,
    );
    expect(out.map((c) => c.id)).toEqual(["make", "year"]);
  });

  test("drops columns declared non-exportable even with data behind them", () => {
    // The AI column launches a chat; its accessor happens to resolve on the
    // row, so only the declaration can keep it out of the file.
    const rows = SAMPLE_ROWS.map((row) => ({ ...row, aiChat: "open" }));
    const out = selectExportColumns(
      cols,
      ["make", "aiChat", "year"],
      { priceWithVat: false, firstOccurence: false, notes: false },
      rows,
    );
    expect(out.map((c) => c.id)).toEqual(["make", "year"]);
  });

  test("appends schema columns missing from columnOrder at the end", () => {
    // Mirrors the TanStack behaviour the on-screen table uses: a stale
    // columnOrder (e.g. a saved view created before a schema column was
    // added) still renders the new column at the end. The CSV should
    // match what's on screen.
    const out = selectExportColumns(cols, ["year"], {}, SAMPLE_ROWS);
    expect(out.map((c) => c.id)).toEqual([
      "year",
      "make",
      "priceWithVat",
      "firstOccurence",
      "notes",
    ]);
  });

  test("keeps real data columns even when every row's value is null", () => {
    // priceWithVat is null on every probe row — a real data column with no
    // values is still legitimate and must be kept (the field is present on
    // the row, just unset). Only `undefined` (i.e. computed cells) drops.
    const allNullRows: Row[] = [
      {
        adId: "x",
        make: "BMW",
        year: 2020,
        priceWithVat: null,
        firstOccurence: null,
        notes: null,
      },
    ];
    const out = selectExportColumns(
      cols,
      ["make", "priceWithVat", "deltaSellRec", "firstOccurence", "notes"],
      { firstOccurence: false, notes: false, year: false },
      allNullRows,
    );
    expect(out.map((c) => c.id)).toEqual(["make", "priceWithVat"]);
  });
});

// ---------------------------------------------------------------------------
// sortRowsForExport
// ---------------------------------------------------------------------------

describe("sortRowsForExport", () => {
  test("sorts by the schema accessor instead of the column id", () => {
    const rows = [{ vehicleTitle: "Volvo" }, { vehicleTitle: "Audi" }];
    const columns = [
      col<(typeof rows)[number]>({
        id: "adTitle",
        accessorKey: "vehicleTitle",
        label: "Vehicle",
        type: ColumnTypes.TEXT,
      }),
    ];
    expect(
      sortRowsForExport(rows, [{ field: "adTitle", dir: "asc" }], columns),
    ).toEqual([rows[1], rows[0]]);
  });

  test("uses enum order and applies secondary sorting within equal priorities", () => {
    const rows = [
      { priority: "urgent", title: "B" },
      { priority: "high", title: "A" },
      { priority: "urgent", title: "A" },
      { priority: "low", title: "A" },
      { priority: "medium", title: "A" },
    ];
    const columns = [
      col<(typeof rows)[number]>({
        id: "priority",
        label: "Priority",
        type: ColumnTypes.BADGE,
        filterOptions: ["none", "low", "medium", "high", "urgent"].map(
          (value) => ({ value, label: value }),
        ),
      }),
      col<(typeof rows)[number]>({
        id: "title",
        label: "Title",
        type: ColumnTypes.TEXT,
      }),
    ];
    expect(
      sortRowsForExport(
        rows,
        [
          { field: "priority", dir: "desc" },
          { field: "title", dir: "asc" },
        ],
        columns,
      ),
    ).toEqual([rows[2], rows[0], rows[1], rows[4], rows[3]]);
  });

  test("honours custom comparators that read other row fields", () => {
    const rows = [
      { title: "A", rank: 2 },
      { title: "Z", rank: 1 },
    ];
    const columns = [
      col<(typeof rows)[number]>({
        id: "title",
        label: "Title",
        type: ColumnTypes.TEXT,
        sortingFn: (a, b) => a.original.rank - b.original.rank,
      }),
    ];
    expect(
      sortRowsForExport(rows, [{ field: "title", dir: "asc" }], columns),
    ).toEqual([rows[1], rows[0]]);
  });

  test("returns a copy when no sort is active", () => {
    const out = sortRowsForExport(SAMPLE_ROWS, [], buildColumns());
    expect(out).not.toBe(SAMPLE_ROWS);
    expect(out.map((r) => r.adId)).toEqual(["a", "b", "c"]);
  });

  test("sorts strings with the grid's null ordering", () => {
    const out = sortRowsForExport(
      [
        ...SAMPLE_ROWS,
        {
          adId: "d",
          make: null,
          year: null,
          priceWithVat: null,
          firstOccurence: null,
          notes: null,
        },
      ],
      [{ field: "make", dir: "asc" }],
      buildColumns(),
    );
    expect(out.map((r) => r.make)).toEqual([null, "Audi", "BMW", "Mercedes"]);
  });

  test("sorts numbers descending with nulls last", () => {
    const out = sortRowsForExport(
      SAMPLE_ROWS,
      [{ field: "priceWithVat", dir: "desc" }],
      buildColumns(),
    );
    // 35000, 25000, null
    expect(out.map((r) => r.priceWithVat)).toEqual([35000, 25000, null]);
  });

  test("supports multi-key sort in declaration order", () => {
    const rows: Row[] = [
      {
        adId: "a1",
        make: "BMW",
        year: 2020,
        priceWithVat: 1,
        firstOccurence: null,
        notes: null,
      },
      {
        adId: "a2",
        make: "BMW",
        year: 2018,
        priceWithVat: 2,
        firstOccurence: null,
        notes: null,
      },
      {
        adId: "a3",
        make: "Audi",
        year: 2025,
        priceWithVat: 3,
        firstOccurence: null,
        notes: null,
      },
    ];
    const out = sortRowsForExport(
      rows,
      [
        { field: "make", dir: "asc" },
        { field: "year", dir: "desc" },
      ],
      buildColumns(),
    );
    expect(out.map((r) => r.adId)).toEqual(["a3", "a1", "a2"]);
  });
});

// ---------------------------------------------------------------------------
// buildCsvString
// ---------------------------------------------------------------------------

describe("buildCsvString", () => {
  test("emits header + body with friendly labels", () => {
    const cols = selectExportColumns(
      buildColumns(),
      ["make", "year", "priceWithVat", "firstOccurence", "notes"],
      {},
      SAMPLE_ROWS,
    );
    const csv = buildCsvString(SAMPLE_ROWS, cols);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Make,Year,Price,First Seen,Notes");
    expect(lines[1]).toBe('BMW,2020,25000,2024-03-15,"has, comma"');
    expect(lines[2]).toBe("Audi,,,,");
    expect(lines[3]).toBe("Mercedes,2021,35000,2024-01-02,umlauts: Größe");
    expect(lines).toHaveLength(4);
  });

  test("uses CRLF row terminators per RFC 4180", () => {
    const cols = selectExportColumns(
      buildColumns(),
      ["make", "year", "priceWithVat", "firstOccurence", "notes"],
      {
        year: false,
        priceWithVat: false,
        firstOccurence: false,
        notes: false,
      },
      SAMPLE_ROWS,
    );
    const csv = buildCsvString([SAMPLE_ROWS[0], SAMPLE_ROWS[1]], cols);
    expect(csv).toBe("Make\r\nBMW\r\nAudi");
  });
});

// ---------------------------------------------------------------------------
// buildExportFilename
// ---------------------------------------------------------------------------

describe("buildExportFilename", () => {
  test("includes branch slug + date in the canonical pattern", () => {
    const out = buildExportFilename({
      prefix: "vehicles",
      scope: "munich-east",
      date: new Date(Date.UTC(2026, 4, 7, 12, 0, 0)),
    });
    // Local date components, not UTC — matches the user's calendar day.
    // We pad month/day so 2026-05-07 stays stable across runs.
    expect(out).toMatch(/^vehicles_munich-east_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("falls back to prefix-only when no branch slug is given", () => {
    const out = buildExportFilename({
      prefix: "vehicles",
      scope: null,
      date: new Date(2026, 0, 1),
    });
    expect(out).toBe("vehicles_2026-01-01.csv");
  });

  test("zero-pads single-digit months and days", () => {
    const out = buildExportFilename({
      prefix: "vehicles",
      scope: "x",
      date: new Date(2026, 0, 5),
    });
    expect(out).toBe("vehicles_x_2026-01-05.csv");
  });
});
