import type { SchemaColumn } from "../column-schema";
import type { GridView } from "../grid-view";
import type { SqlFragment } from "./fragment";

export type SqlDialect = "postgres" | "snowflake";
export type SqlColumnType =
  | "text"
  | "number"
  | "date"
  | "timestamp"
  | "timestamptz"
  | "text[]";
export interface SqlGridColumn<TRow extends object = Record<string, unknown>>
  extends SchemaColumn<TRow> {
  sqlType?: SqlColumnType;
  /** Set false only when the SELECT output cannot be null, including after joins. */
  sqlNullable?: boolean;
}
export interface GridPage {
  limit: number;
  offset: number;
}
export interface GridRequest {
  view: GridView;
  page: GridPage;
}
export interface GridResult<TRow> {
  rows: TRow[];
  total?: number;
  page: GridPage;
}
export interface GridQueryInput<TRow extends object> extends GridRequest {
  columns: readonly SqlGridColumn<TRow>[];
  count: boolean;
  maxLimit?: number;
  timeZone: string;
  signal?: AbortSignal;
}
export interface GridSource<TRow extends object> {
  query(input: GridQueryInput<TRow>): Promise<GridResult<TRow>>;
}
export interface SqlSourceOptions {
  query: SqlFragment;
  /** Unique, non-null output column; may be absent from displayed columns. */
  rowKey: string;
}
