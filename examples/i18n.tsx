// The README's i18n example, kept compiling. `bun run typecheck` covers this
// file, so an API change that breaks the documented pattern breaks the build.
//
// `Translate` stands in for your i18n library's translator - next-intl's
// `useTranslations()` or react-i18next's `t` fit it as-is - so the example
// compiles without either installed.

import { useMemo } from "react";
import { col, type SchemaColumn } from "../src";
import { DataGrid } from "../src/react";
import { ColumnTypes } from "./column-types";

type Translate = (key: string) => string;

interface Car {
  id: string;
  price: number;
  status: string;
}

const STATUSES = ["available", "reserved", "sold"] as const;

// Columns are built from the translator, not at module level: a new locale
// gives a new `t`, a new `t` gives new columns, and the grid re-renders with
// them. Everything the view stores - order, widths, sort, filters, groups -
// is keyed by column id and raw value, so none of it resets on the switch.
function useCarColumns(t: Translate): SchemaColumn<Car>[] {
  return useMemo(
    () => [
      col<Car>({
        id: "price",
        label: t("cars.price"),
        description: t("cars.price.description"),
        type: ColumnTypes.CURRENCY,
      }),
      col<Car>({
        id: "status",
        label: t("cars.status"),
        description: t("cars.status.description"),
        type: ColumnTypes.BADGE,
        // Labels are translated, values stay the stored codes, so an active
        // `status is sold` filter still matches after the switch.
        filterOptions: STATUSES.map((value) => ({
          value,
          label: t(`cars.status.${value}`),
        })),
      }),
    ],
    [t],
  );
}

export function CarsGrid({ rows, t }: { rows: readonly Car[]; t: Translate }) {
  const columns = useCarColumns(t);
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      renderCell={(column, row) => String(row[column.id as keyof Car] ?? "")}
      emptyMessage={t("grid.empty")}
    />
  );
}
