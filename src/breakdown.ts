import type { PaletteColor } from "./palette";

export interface CellBreakdownItem {
  label: string;
  value: string | null;
  columnKey?: string;
  rawValue?: number | string | null;
  color?: PaletteColor;
  emphasis?: boolean;
}

export interface CellBreakdown {
  value?: string | null;
  items: readonly CellBreakdownItem[];
}

export type CellBreakdownSpec<TData> = (row: TData) => CellBreakdown | null;
