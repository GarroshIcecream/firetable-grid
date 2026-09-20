import type { RowData } from "@tanstack/react-table";
import type { CellBreakdownSpec } from "./breakdown";
import type {
  ColumnType,
  FilterOp,
  NumberFormat,
  NumericUnit,
} from "./column-vocabulary";
import type { EnumColorMap } from "./enum-color";
import type { AppCellContext, AppColumnDef, AppSortFn } from "./tanstack";
import type { ThresholdList } from "./threshold";

export interface FilterOption {
  value: string;
  label: string;
  badge?: React.ReactNode;
}

export interface SchemaColumn<TData extends RowData> {
  unit?: NumericUnit;
  id: string;
  accessorKey?: string;
  labelKey?: Extract<keyof TData, string>;
  label: string;
  type: ColumnType;
  width: number;
  minWidth: number;
  visible: boolean;
  manageable: boolean;
  exportable: boolean;
  frozen: boolean;
  sortable: boolean;
  groupable: boolean;
  filterable: boolean;
  operators: readonly FilterOp[];
  filterOptions?: readonly FilterOption[];
  dynamicOptions: boolean;
  multiSelect: boolean;
  searchable: boolean;
  getFilterValue?: (row: TData) => unknown;
  cellVariant?: string;
  cell?: (ctx: AppCellContext<TData, unknown>) => React.ReactNode;
  breakdown?: CellBreakdownSpec<TData>;
  category?: string;
  thresholds?: ThresholdList;
  sampleValue?: number | string;
  enumValues?: readonly string[];
  enumColors?: EnumColorMap;
  numberFormat?: NumberFormat;
  sortingFn?: AppSortFn<TData>;
  cellTint?: (row: TData) => string | undefined;
}

interface ColDef<TData extends RowData> {
  unit?: NumericUnit;
  id: string;
  accessorKey?: string;
  labelKey?: Extract<keyof TData, string>;
  label: string;
  type: ColumnType;
  width?: number;
  minWidth?: number;
  visible?: boolean;
  manageable?: boolean;
  exportable?: boolean;
  frozen?: boolean;
  sortable?: boolean | null;
  groupable?: boolean | null;
  filterable?: boolean | null;
  operators?: readonly FilterOp[];
  filterOptions?: readonly FilterOption[];
  dynamicOptions?: boolean;
  multiSelect?: boolean;
  searchable?: boolean;
  getFilterValue?: (row: TData) => unknown;
  cellVariant?: string;
  cell?: (ctx: AppCellContext<TData, unknown>) => React.ReactNode;
  breakdown?: CellBreakdownSpec<TData>;
  category?: string;
  thresholds?: ThresholdList;
  sampleValue?: number | string;
  enumValues?: readonly string[];
  enumColors?: EnumColorMap;
  numberFormat?: NumberFormat;
  sortingFn?: AppSortFn<TData>;
  cellTint?: (row: TData) => string | undefined;
}

const COLUMN_DEFAULTS = {
  width: 100,
  minWidth: 70,
  visible: true,
  manageable: true,
  exportable: true,
  frozen: false,
} as const;

export function col<TData extends RowData>(
  def: ColDef<TData>,
): SchemaColumn<TData> {
  const filterable = def.filterable ?? def.type.filterType !== null;
  const operators =
    def.operators ?? defaultOperatorsForType(def.type.filterType);
  return {
    id: def.id,
    accessorKey: def.accessorKey ?? def.id,
    labelKey: def.labelKey,
    label: def.label,
    type: def.type,
    width: def.width ?? COLUMN_DEFAULTS.width,
    minWidth: def.minWidth ?? COLUMN_DEFAULTS.minWidth,
    visible: def.visible ?? COLUMN_DEFAULTS.visible,
    manageable: def.manageable ?? COLUMN_DEFAULTS.manageable,
    exportable: def.exportable ?? COLUMN_DEFAULTS.exportable,
    frozen: def.frozen ?? COLUMN_DEFAULTS.frozen,
    sortable: def.sortable ?? def.type.sortable,
    groupable: def.groupable ?? def.type.groupable,
    filterable,
    operators,
    filterOptions: def.filterOptions,
    dynamicOptions: def.dynamicOptions ?? false,
    multiSelect:
      def.multiSelect ??
      (def.type.filterType === "enum" || def.dynamicOptions === true),
    searchable: def.searchable ?? def.type.filterType === "text",
    getFilterValue: def.getFilterValue,
    cellVariant: def.cellVariant,
    cell: def.cell,
    breakdown: def.breakdown,
    category: def.category,
    thresholds: def.thresholds,
    sampleValue: def.sampleValue,
    enumValues: def.enumValues,
    enumColors: def.enumColors,
    numberFormat: def.numberFormat,
    unit: def.unit ?? def.type.unit,
    sortingFn: def.sortingFn,
    cellTint: def.cellTint,
  };
}

export function defaultOperatorsForType(
  filterType: ColumnType["filterType"],
): readonly FilterOp[] {
  if (filterType === "numeric")
    return ["=", "≠", ">", "<", "≥", "≤", "is empty", "is not empty"];
  if (filterType === "enum")
    return ["is", "is not", "is empty", "is not empty"];
  if (filterType === "text")
    return ["is", "is not", "contains", "is empty", "is not empty"];
  if (filterType === "date") return ["on", "before", "after", "between"];
  return [];
}

// Rank enum values by their declared order (a column's `filterOptions` are in
// enum-declaration order). Unknown / empty values sort last. Direction is
// applied by TanStack on top of this. Enum columns would otherwise sort
// alphabetically by the raw constant string, which is meaningless for severity
// ordered enum scales, where declaration order is the meaningful order.
export function enumIndexComparator(order: readonly string[]) {
  const rank = new Map(order.map((value, index) => [value, index]));
  const missing = order.length;
  return (a: unknown, b: unknown): number => {
    const ra = rank.get(String(a ?? "")) ?? missing;
    const rb = rank.get(String(b ?? "")) ?? missing;
    return ra - rb;
  };
}

// Convert SchemaColumn array to TanStack ColumnDef array
export function toColumnDefs<TData extends RowData>(
  schemaCols: readonly SchemaColumn<TData>[],
): AppColumnDef<TData>[] {
  return schemaCols.map((sc) => {
    let sortFn = sc.sortingFn;
    if (
      !sortFn &&
      sc.type.filterType === "enum" &&
      sc.filterOptions &&
      !sc.dynamicOptions
    ) {
      const compare = enumIndexComparator(
        sc.filterOptions.map((option) => option.value),
      );
      sortFn = (rowA, rowB, columnId) =>
        compare(rowA.getValue(columnId), rowB.getValue(columnId));
    }
    return {
      id: sc.id,
      accessorKey: sc.accessorKey,
      header: sc.label,
      size: sc.width,
      minSize: sc.minWidth,
      enableSorting: sc.sortable,
      enableHiding: sc.manageable,
      cell: sc.cell,
      ...(sortFn ? { sortFn } : {}),
      meta: {
        type: sc.type,
        labelKey: sc.labelKey,
        frozen: sc.frozen,
        manageable: sc.manageable,
        cellVariant: sc.cellVariant,
        visible: sc.visible,
        groupable: sc.groupable,
        category: sc.category,
        numberFormat: sc.numberFormat,
        breakdown: sc.breakdown,
        cellTint: sc.cellTint,
      },
    };
  });
}

// Build initial column order from schema
export function buildColOrder<TData extends RowData>(
  columns: SchemaColumn<TData>[],
): string[] {
  return columns.map((c) => c.id);
}

// Build initial visibility state from schema
export function buildVisibility<TData extends RowData>(
  columns: SchemaColumn<TData>[],
): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const c of columns) {
    if (!c.visible) {
      vis[c.id] = false;
    }
  }
  return vis;
}
