import { col } from "../src";
import type { SqlGridColumn } from "../src/sql";
import { ColumnTypes } from "./column-types";

export interface ListingRow {
  id: string;
  make: string;
  price: number;
  createdAt: string;
}
export const listingColumns: SqlGridColumn<ListingRow>[] = [
  col({
    id: "id",
    label: "ID",
    type: ColumnTypes.TEXT,
    visible: false,
    searchable: false,
  }),
  col({ id: "make", label: "Make", type: ColumnTypes.TEXT }),
  col({ id: "price", label: "Price", type: ColumnTypes.CURRENCY }),
  {
    ...col({ id: "createdAt", label: "Created", type: ColumnTypes.DATE }),
    sqlType: "date",
  },
];
