// Generic column vocabulary for the table engine: the vocabulary a column
// declares itself in, independent of any particular dataset. The catalogue of
// concrete column types a product defines lives with that product — see
// `examples/column-types.ts` for a worked catalogue you can copy.

export type DataType =
  | "check"
  | "index"
  | "composite"
  | "action"
  | "number"
  | "enum"
  | "text"
  | "date";

export type FilterType = "numeric" | "enum" | "text" | "date" | null;

export type NumericUnit =
  | "number"
  | "percentage_points"
  | "currency"
  | "days"
  | "kilometers";

export type NumberFormat = "currency" | "percent" | "decimal" | "integer";
export type CellAlignment = "start" | "center" | "end";
export const FILTER_OP = {
  eq: "=",
  ne: "≠",
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
  is: "is",
  isNot: "is not",
  contains: "contains",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  on: "on",
  before: "before",
  after: "after",
  between: "between",
} as const;

export type FilterOp = (typeof FILTER_OP)[keyof typeof FILTER_OP];

export const AGGREGATION_TYPES = ["avg", "sum", "min", "max", "count"] as const;
export type AggregationType = (typeof AGGREGATION_TYPES)[number];

export const AGG_SYMBOLS: Record<AggregationType, string> = {
  avg: "x̄",
  sum: "Σ",
  min: "↓",
  max: "↑",
  count: "#",
};

export interface ColumnType {
  readonly dataType: DataType;
  readonly unit?: NumericUnit;
  readonly cellRenderer: string | null;
  readonly filterType: FilterType;
  readonly sortable: boolean;
  readonly groupable: boolean;
  readonly aggregatable: boolean;
  readonly cellAlignment?: CellAlignment;
  readonly formatPrefix?: string;
  readonly formatSuffix?: string;
  readonly numberFormat?: NumberFormat;
  readonly decimals?: number;
  readonly colorByThreshold?: boolean;
  readonly thresholdOptIn?: boolean;
  readonly enumColorOptIn?: boolean;
  readonly setValued?: boolean;
  readonly ratioStored?: boolean;
  readonly ratioFloor?: boolean;
  readonly sampleValue?: number | string;
}
