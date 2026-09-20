import { describe, expect, test } from "bun:test";
import { ColumnTypes } from "../examples/column-types";
import {
  ATTENTION_DEFAULT_THRESHOLDS,
  col,
  DAYS_DEFAULT_THRESHOLDS,
  type ExportCellContext,
  exportCellText,
  PLAIN_EXPORT_CONTEXT,
  resolveExportCell,
  type SchemaColumn,
  TREND_DEFAULT_THRESHOLDS,
} from "../src";

type Row = {
  make: string | null;
  makeLabel: string | null;
  priceWithVat: number | null;
  mileage: number | null;
  daysOnDisplayCalc: number | null;
  attentionScoreTotalRelative: number | null;
  year: number | null;
  carDemand: number | null;
  firstOccurence: string | null;
  pctDelta: number | null;
  fairPriceZone: string | null;
};

const columns = {
  make: col<Row>({
    id: "make",
    labelKey: "makeLabel",
    label: "Make",
    type: ColumnTypes.TEXT,
  }),
  priceWithVat: col<Row>({
    id: "priceWithVat",
    label: "Price",
    type: ColumnTypes.CURRENCY,
  }),
  mileage: col<Row>({ id: "mileage", label: "Mileage", type: ColumnTypes.KM }),
  daysOnDisplayCalc: col<Row>({
    id: "daysOnDisplayCalc",
    label: "Days",
    type: ColumnTypes.DAYS,
  }),
  attentionScoreTotalRelative: col<Row>({
    id: "attentionScoreTotalRelative",
    label: "Attention",
    type: ColumnTypes.PROGRESS,
  }),
  year: col<Row>({ id: "year", label: "Year", type: ColumnTypes.RAW_NUMBER }),
  carDemand: col<Row>({
    id: "carDemand",
    label: "Demand",
    type: ColumnTypes.DECIMAL,
  }),
  firstOccurence: col<Row>({
    id: "firstOccurence",
    label: "First seen",
    type: ColumnTypes.DATE,
  }),
  pctDelta: col<Row>({
    id: "pctDelta",
    label: "Delta %",
    type: ColumnTypes.TREND,
    numberFormat: "percent",
  }),
  fairPriceZone: col<Row>({
    id: "fairPriceZone",
    label: "Zone",
    type: ColumnTypes.BADGE,
  }),
} satisfies Record<string, SchemaColumn<Row>>;

const emptyRow: Row = {
  make: null,
  makeLabel: null,
  priceWithVat: null,
  mileage: null,
  daysOnDisplayCalc: null,
  attentionScoreTotalRelative: null,
  year: null,
  carDemand: null,
  firstOccurence: null,
  pctDelta: null,
  fairPriceZone: null,
};

const CURRENCY_FMT = '#,##0" €"';

const noColours: ExportCellContext = {
  colorsFor: () => undefined,
  enumLabel: () => null,
  currencySymbol: "€",
};

function withColours(
  map: Record<
    string,
    { thresholds?: typeof DAYS_DEFAULT_THRESHOLDS; enumColors?: never }
  >,
): ExportCellContext {
  return {
    colorsFor: (id) => map[id],
    enumLabel: () => null,
    currencySymbol: "€",
  };
}

describe("resolveExportCell — value typing", () => {
  test("numbers stay numbers so the spreadsheet can sum and filter them", () => {
    const cell = resolveExportCell(
      { ...emptyRow, priceWithVat: 24900 },
      columns.priceWithVat,
      noColours,
    );
    expect(cell.value).toBe(24900);
  });

  test("dates become Date objects, not pre-formatted strings", () => {
    const cell = resolveExportCell(
      { ...emptyRow, firstOccurence: "2026-05-12T08:30:00.000Z" },
      columns.firstOccurence,
      noColours,
    );
    expect(cell.value).toBeInstanceOf(Date);
    // A date column carries a calendar day, not an instant: the value lands on
    // LOCAL midnight of the string's YYYY-MM-DD prefix. That is what makes the
    // workbook agree with `toYmd`, which the filter and grouping paths use —
    // and ExcelJS writes a Date at its local wall clock, so a UTC-parsed
    // "2026-05-12" would surface as the 11th anywhere west of Greenwich.
    const value = cell.value as Date;
    expect(value.getFullYear()).toBe(2026);
    expect(value.getMonth()).toBe(4);
    expect(value.getDate()).toBe(12);
    expect(value.getHours()).toBe(0);
    expect(value.getMinutes()).toBe(0);
  });

  test("an unparseable date degrades to null rather than a broken cell", () => {
    const cell = resolveExportCell(
      { ...emptyRow, firstOccurence: "not a date" },
      columns.firstOccurence,
      noColours,
    );
    expect(cell.value).toBeNull();
  });

  test("non-finite numbers are dropped, not written as NaN", () => {
    const cell = resolveExportCell(
      { ...emptyRow, priceWithVat: Number.NaN },
      columns.priceWithVat,
      noColours,
    );
    expect(cell.value).toBeNull();
  });

  test("empty strings collapse to null so blank cells stay blank", () => {
    const cell = resolveExportCell(
      { ...emptyRow, make: "" },
      columns.make,
      noColours,
    );
    expect(cell.value).toBeNull();
  });

  test("enum values are translated through the context", () => {
    const cell = resolveExportCell(
      { ...emptyRow, fairPriceZone: "FAIR_PRICE" },
      columns.fairPriceZone,
      {
        colorsFor: () => undefined,
        enumLabel: () => "Fair price",
        currencySymbol: "€",
      },
    );
    expect(cell.value).toBe("Fair price");
  });

  test("an untranslated enum keeps its raw value instead of blanking", () => {
    const cell = resolveExportCell(
      { ...emptyRow, fairPriceZone: "SOMETHING_NEW" },
      columns.fairPriceZone,
      noColours,
    );
    expect(cell.value).toBe("SOMETHING_NEW");
  });
});

describe("resolveExportCell — catalogue-backed columns", () => {
  // `make`, `modelFamily` and `trimLevel` store an opaque catalogue token and
  // carry the label the grid renders on a sibling field. Reading the accessor
  // alone put `MAKE_AUDI-MODELFAMILY_Q2` in the file where the table shows
  // "Q2".
  test("a declared label field wins over the stored token", () => {
    const cell = resolveExportCell(
      { ...emptyRow, make: "MAKE_AUDI", makeLabel: "Audi" },
      columns.make,
      noColours,
    );
    expect(cell.value).toBe("Audi");
  });

  test("an unresolved label falls back to the token, never to a blank cell", () => {
    const cell = resolveExportCell(
      { ...emptyRow, make: "MAKE_AUDI" },
      columns.make,
      noColours,
    );
    expect(cell.value).toBe("MAKE_AUDI");
  });

  test("a column with no label field still exports its own value", () => {
    const plainMake = col<Row>({
      id: "make",
      label: "Make",
      type: ColumnTypes.TEXT,
    });
    const cell = resolveExportCell(
      { ...emptyRow, make: "MAKE_AUDI", makeLabel: "Audi" },
      plainMake,
      noColours,
    );
    expect(cell.value).toBe("MAKE_AUDI");
  });
});

describe("resolveExportCell — number formats come from column metadata", () => {
  test("currency uses the euro format", () => {
    const cell = resolveExportCell(
      { ...emptyRow, priceWithVat: 1 },
      columns.priceWithVat,
      noColours,
    );
    expect(cell.numFmt).toBe(CURRENCY_FMT);
  });

  test("both ways of declaring money agree on one format", () => {
    // CURRENCY declares a euro `formatPrefix`; TREND declares
    // `numberFormat: "currency"`. The grid renders both through Intl's
    // currency style, so the export must not split them into symbol-before
    // and symbol-after variants.
    const trendMoney = col<Row>({
      id: "deltaSellRec",
      label: "Delta",
      type: ColumnTypes.TREND,
      numberFormat: "currency",
    });
    const viaPrefix = resolveExportCell(
      { ...emptyRow, priceWithVat: 1 },
      columns.priceWithVat,
      noColours,
    ).numFmt;
    const viaNumberFormat = resolveExportCell(
      { deltaSellRec: 1 } as unknown as Row,
      trendMoney,
      noColours,
    ).numFmt;
    expect(viaPrefix).toBe(viaNumberFormat as string);
  });

  test("a metadata suffix becomes a quoted literal", () => {
    expect(
      resolveExportCell({ ...emptyRow, mileage: 1 }, columns.mileage, noColours)
        .numFmt,
    ).toBe('#,##0" km"');
    expect(
      resolveExportCell(
        { ...emptyRow, daysOnDisplayCalc: 1 },
        columns.daysOnDisplayCalc,
        noColours,
      ).numFmt,
    ).toBe('#,##0" d"');
  });

  test("ratio-stored columns are percentages of a fraction, not of points", () => {
    // PROGRESS values are 0..1 in the row; `0%` makes Excel do the ×100 once.
    const cell = resolveExportCell(
      { ...emptyRow, attentionScoreTotalRelative: 0.55 },
      columns.attentionScoreTotalRelative,
      noColours,
    );
    expect(cell.value).toBe(0.55);
    expect(cell.numFmt).toBe("0%");
  });

  test("trend percent is already in points, so it must not be Excel's percent", () => {
    // relPriceDiff = 4.4 means 4.4%. `0.0%` would render it as 440%.
    const cell = resolveExportCell(
      { ...emptyRow, pctDelta: 4.4 },
      columns.pctDelta,
      noColours,
    );
    expect(cell.numFmt).toBe('0.0"%"');
    expect(cell.numFmt).not.toContain("0.0%");
  });

  test("conversion rates keep two decimals instead of rounding to whole percent", () => {
    // Portal view→lead rates sit below 1 %, and the grid deliberately renders
    // them with two decimals ("a real zero must read 0.00 %"). `#,##0"%"`
    // would print every one of them as 0%.
    const conversion = col<Row>({
      id: "totalViewToLead30d",
      label: "View to lead",
      type: ColumnTypes.LISTING_RATE,
    });
    const cell = resolveExportCell(
      { totalViewToLead30d: 0.25 } as unknown as Row,
      conversion,
      noColours,
    );
    expect(cell.value).toBe(0.25);
    expect(cell.numFmt).toBe('0.00"%"');
  });

  test("rawNumber keeps no thousands separator, decimal keeps one place", () => {
    expect(
      resolveExportCell({ ...emptyRow, year: 2020 }, columns.year, noColours)
        .numFmt,
    ).toBe("0");
    expect(
      resolveExportCell(
        { ...emptyRow, carDemand: 3.14 },
        columns.carDemand,
        noColours,
      ).numFmt,
    ).toBe("0.0");
  });
});

describe("resolveExportCell — enum columns whose row value is a number", () => {
  test("carRating exports its label and colour, not the bare digit", () => {
    // `deriveCarRating` puts a NUMBER on the row while the enum colours and
    // labels are keyed on the strings "1".."5". Branching on `typeof raw`
    // instead of the declared dataType exported an uncoloured `3`.
    const carRating = col<Row>({
      id: "carRating",
      label: "Car rating",
      type: ColumnTypes.ACCURACY,
    });
    const cell = resolveExportCell(
      { carRating: 3 } as unknown as Row,
      carRating,
      {
        colorsFor: () => ({
          enumColors: [
            { value: "3", color: { hue: "yellow", level: "medium" } },
          ],
        }),
        enumLabel: (_id, value) => (value === "3" ? "3 - Poor" : null),
        currencySymbol: "€",
      },
    );
    expect(cell.value).toBe("3 - Poor");
    expect(cell.color).toEqual({ hue: "yellow", level: "medium" });
  });
});

describe("resolveExportCell — colour follows the Column Registry", () => {
  test("a threshold-capable column with no resolved thresholds stays uncoloured", () => {
    // 51 of the 167 canonical columns are in exactly this state in a virgin
    // org; the grid renders them as plain text and so must the export.
    const cell = resolveExportCell(
      { ...emptyRow, daysOnDisplayCalc: 90 },
      columns.daysOnDisplayCalc,
      { colorsFor: () => ({}), enumLabel: () => null, currencySymbol: "€" },
    );
    expect(cell.color).toBeUndefined();
  });

  test("thresholds paint the bucket the value falls into", () => {
    const ctx = withColours({
      daysOnDisplayCalc: { thresholds: DAYS_DEFAULT_THRESHOLDS },
    });
    expect(
      resolveExportCell(
        { ...emptyRow, daysOnDisplayCalc: 12 },
        columns.daysOnDisplayCalc,
        ctx,
      ).color,
    ).toEqual({ hue: "green", level: "dark" });
    expect(
      resolveExportCell(
        { ...emptyRow, daysOnDisplayCalc: 149 },
        columns.daysOnDisplayCalc,
        ctx,
      ).color,
    ).toEqual({ hue: "red", level: "dark" });
  });

  test("the upTo bound is inclusive", () => {
    const ctx = withColours({
      daysOnDisplayCalc: { thresholds: DAYS_DEFAULT_THRESHOLDS },
    });
    expect(
      resolveExportCell(
        { ...emptyRow, daysOnDisplayCalc: 30 },
        columns.daysOnDisplayCalc,
        ctx,
      ).color,
    ).toEqual({ hue: "green", level: "dark" });
  });

  test("progress thresholds compare against the stored fraction", () => {
    const ctx = withColours({
      attentionScoreTotalRelative: {
        thresholds: ATTENTION_DEFAULT_THRESHOLDS,
      },
    });
    expect(
      resolveExportCell(
        { ...emptyRow, attentionScoreTotalRelative: 0.2 },
        columns.attentionScoreTotalRelative,
        ctx,
      ).color,
    ).toEqual({ hue: "green", level: "dark" });
  });

  test("a trend of exactly zero is the neutral no-change tone, not a bucket", () => {
    // The grid greys a zero trend regardless of thresholds; TREND's default
    // list would otherwise paint it red (`upTo: 0`).
    const ctx = withColours({
      pctDelta: { thresholds: TREND_DEFAULT_THRESHOLDS },
    });
    expect(
      resolveExportCell({ ...emptyRow, pctDelta: 0 }, columns.pctDelta, ctx)
        .color,
    ).toEqual({ hue: "gray", level: "dark" });
    expect(
      resolveExportCell({ ...emptyRow, pctDelta: -3 }, columns.pctDelta, ctx)
        .color,
    ).toEqual({ hue: "red", level: "dark" });
  });
});

describe("exportCellText — the CSV projection", () => {
  test("dates flatten to ISO day precision", () => {
    expect(
      exportCellText(
        resolveExportCell(
          { ...emptyRow, firstOccurence: "2026-05-12T08:30:00.000Z" },
          columns.firstOccurence,
          noColours,
        ),
      ),
    ).toBe("2026-05-12");
  });

  test("numbers stay unformatted so a re-import parses them", () => {
    expect(
      exportCellText(
        resolveExportCell(
          { ...emptyRow, priceWithVat: 24900 },
          columns.priceWithVat,
          noColours,
        ),
      ),
    ).toBe("24900");
  });

  test("null becomes an empty cell", () => {
    expect(
      exportCellText(
        resolveExportCell(emptyRow, columns.priceWithVat, noColours),
      ),
    ).toBe("");
  });

  test("a ratio column carries the percentage the grid prints, not the fraction", () => {
    // The workbook reaches 55 % from 0.55 through `0%`; CSV has no format
    // layer, so an unscaled 0.55 would read as a hundredth of the column.
    const cell = resolveExportCell(
      { ...emptyRow, attentionScoreTotalRelative: 0.55 },
      columns.attentionScoreTotalRelative,
      noColours,
    );
    expect(cell.value).toBe(0.55);
    expect(exportCellText(cell)).toBe("55");
  });

  test("a floored ratio column matches the grid, not Excel's rounding", () => {
    // FEATURE_SCORE is a PostgreSQL REAL and the grid floors it
    // (`toEquipmentPercent`). On the dev snapshot 144 of 948 rows land a point
    // apart from `Math.round`, so the two must not diverge here.
    const equipment = col<Row>({
      id: "featureScore",
      label: "Equip. Score",
      type: ColumnTypes.PROGRESS_FLOOR,
    });
    for (const [stored, expected] of [
      [0.449, 44],
      [0.397, 39],
      [0.275, 27],
      [0.55, 55],
    ] as const) {
      const cell = resolveExportCell(
        { featureScore: stored } as unknown as Row,
        equipment,
        noColours,
      );
      expect(cell.value).toBe(expected);
      expect(cell.numFmt).toBe('0"%"');
      expect(exportCellText(cell)).toBe(String(expected));
    }
  });

  test("a rounded ratio column keeps the fraction for the workbook", () => {
    // The two ratio flavours must not be conflated: PROGRESS still hands Excel
    // the 0..1 value plus `0%`, and only the CSV text is scaled.
    const cell = resolveExportCell(
      { ...emptyRow, attentionScoreTotalRelative: 0.449 },
      columns.attentionScoreTotalRelative,
      noColours,
    );
    expect(cell.value).toBe(0.449);
    expect(cell.numFmt).toBe("0%");
    expect(exportCellText(cell)).toBe("45");
  });

  test("a points-based percent column is already what the grid shows", () => {
    expect(
      exportCellText(
        resolveExportCell(
          { ...emptyRow, pctDelta: 4.4 },
          columns.pctDelta,
          noColours,
        ),
      ),
    ).toBe("4.4");
  });
});

describe("resolveExportCell — codes become the labels the grid shows", () => {
  const setValued = col<Row>({
    id: "dailyActionReason",
    label: "Decision Reason",
    type: ColumnTypes.EVIDENCE_CHIPS,
  });

  test("a set-valued column expands into one label per code", () => {
    const cell = resolveExportCell(
      { dailyActionReason: "PRICE_POSITION,LEAD_ACTIVITY" } as unknown as Row,
      setValued,
      {
        colorsFor: () => undefined,
        enumLabel: (_id, value) =>
          value === "PRICE_POSITION" ? "Price position" : "Lead activity",
        currencySymbol: "€",
      },
    );
    expect(cell.value).toBe("Price position, Lead activity");
  });

  test("an untranslated code keeps its raw token rather than dropping the cell", () => {
    const cell = resolveExportCell(
      { dailyActionReason: "PRICE_POSITION,MYSTERY" } as unknown as Row,
      setValued,
      {
        colorsFor: () => undefined,
        enumLabel: (_id, value) =>
          value === "PRICE_POSITION" ? "Price position" : null,
        currencySymbol: "€",
      },
    );
    expect(cell.value).toBe("Price position, MYSTERY");
  });

  test("filterOptions label a column on a surface with no translator", () => {
    // The client-built exports (issues, market flag) run without a Column
    // Registry and without a translator; the column's own options already
    // hold the localized labels.
    const status = col<Row>({
      id: "status",
      label: "Status",
      type: ColumnTypes.BADGE,
      filterOptions: [{ value: "IN_PROGRESS", label: "In progress" }],
    });
    const cell = resolveExportCell(
      { status: "IN_PROGRESS" } as unknown as Row,
      status,
      PLAIN_EXPORT_CONTEXT,
    );
    expect(cell.value).toBe("In progress");
  });
});
