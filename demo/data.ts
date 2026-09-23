// Sample dataset for the demo. Deliberately not FireTable's domain — the point
// is that the engine only ever sees `SchemaColumn` descriptions and rows.

import { ColumnTypes } from "../examples/column-types";
import { col, type SchemaColumn, type ThresholdList } from "../src";

export interface Item {
  rowIndex: number;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  price: number;
  daysInStock: number;
  marginTrend: number;
  quality: number;
  addedOn: string;
  warehouse: string;
  unitsOnHand: number;
  reorderPoint: number;
  leadTimeDays: number;
  lastCountedOn: string;
  returnsRate: number;
  weightKg: number;
  status: string;
}

const CATEGORIES = ["Frames", "Wheels", "Drivetrain", "Brakes", "Apparel"];
const SUPPLIERS = ["Nordwind", "Aeolus", "Certo", "Vantage"];
const NAMES = [
  "Alloy Frame 54",
  "Carbon Fork",
  "Rim Brake Set",
  "Chainring 42T",
  "Hub Bearing",
  "Bar Tape",
  "Seat Post 27.2",
  "Cassette 11-32",
  "Tubeless Tyre",
  "Disc Rotor 160",
  "Crank Arm 172.5",
  "Jersey Merino",
];

// A tiny deterministic PRNG so the table is identical on every reload — a demo
// that reshuffles itself is impossible to compare against the state panel.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRows(count = 28): Item[] {
  const rand = mulberry32(20260920);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  return Array.from({ length: count }, (_, i) => {
    const day = 1 + Math.floor(rand() * 28);
    return {
      rowIndex: i + 1,
      sku: `SKU-${String(1000 + i)}`,
      name: pick(NAMES),
      category: pick(CATEGORIES),
      supplier: pick(SUPPLIERS),
      price: Math.round((40 + rand() * 1800) * 100) / 100,
      daysInStock: Math.floor(rand() * 120),
      marginTrend: Math.round((rand() * 40 - 20) * 10) / 10,
      quality: Math.round(rand() * 100) / 100,
      addedOn: `2026-0${1 + Math.floor(rand() * 9)}-${String(day).padStart(2, "0")}`,
      warehouse: pick(WAREHOUSES),
      unitsOnHand: Math.floor(rand() * 400),
      reorderPoint: 20 + Math.floor(rand() * 80),
      leadTimeDays: 2 + Math.floor(rand() * 40),
      lastCountedOn: `2026-0${1 + Math.floor(rand() * 9)}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
      returnsRate: Math.round(rand() * 100) / 100,
      weightKg: Math.round(rand() * 2400) / 100,
      status: pick(STATUSES),
    };
  });
}

const WAREHOUSES = ["Rotterdam", "Hamburg", "Lyon", "Katowice"];
const STATUSES = ["active", "clearance", "discontinued", "backorder"];

const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));

// Threshold bands live on the column, not in the engine — these are demo-only.
const DAYS_THRESHOLDS: ThresholdList = [
  { upTo: 30, color: { hue: "green", level: "dark" } },
  { upTo: 60, color: { hue: "orange", level: "dark" } },
  { color: { hue: "red", level: "dark" } },
];

const TREND_THRESHOLDS: ThresholdList = [
  { upTo: 0, color: { hue: "red", level: "dark" } },
  { color: { hue: "green", level: "dark" } },
];

const QUALITY_THRESHOLDS: ThresholdList = [
  { upTo: 0.33, color: { hue: "green", level: "dark" } },
  { upTo: 0.66, color: { hue: "orange", level: "dark" } },
  { color: { hue: "red", level: "dark" } },
];

const PRICE_THRESHOLDS: ThresholdList = [
  { upTo: 200, color: { hue: "gray", level: "light" } },
  { upTo: 800, color: { hue: "blue", level: "light" } },
  { color: { hue: "indigo", level: "medium" } },
];

export function buildColumns(): SchemaColumn<Item>[] {
  return [
    col<Item>({
      id: "rowIndex",
      label: "#",
      type: ColumnTypes.INDEX,
      width: 48,
      minWidth: 48,
      frozen: true,
    }),
    col<Item>({
      id: "name",
      label: "Item",
      type: ColumnTypes.TEXT,
      width: 180,
      frozen: true,
      searchable: true,
    }),
    col<Item>({
      id: "sku",
      label: "SKU",
      type: ColumnTypes.TEXT,
      width: 110,
      searchable: true,
    }),
    col<Item>({
      id: "category",
      label: "Category",
      type: ColumnTypes.BADGE,
      width: 130,
      groupable: true,
      filterOptions: options(CATEGORIES),
    }),
    col<Item>({
      id: "supplier",
      label: "Supplier",
      type: ColumnTypes.BADGE,
      width: 130,
      groupable: true,
      filterOptions: options(SUPPLIERS),
    }),
    col<Item>({
      id: "price",
      label: "Price",
      type: ColumnTypes.CURRENCY,
      width: 120,
      thresholds: PRICE_THRESHOLDS,
    }),
    col<Item>({
      id: "daysInStock",
      label: "In stock",
      type: ColumnTypes.DAYS,
      width: 110,
      thresholds: DAYS_THRESHOLDS,
    }),
    col<Item>({
      id: "marginTrend",
      label: "Margin trend",
      type: ColumnTypes.TREND,
      width: 130,
      thresholds: TREND_THRESHOLDS,
    }),
    col<Item>({
      id: "quality",
      label: "Quality",
      type: ColumnTypes.PROGRESS,
      width: 120,
      thresholds: QUALITY_THRESHOLDS,
    }),
    col<Item>({
      id: "addedOn",
      label: "Added",
      type: ColumnTypes.DATE,
      width: 120,
      groupable: true,
    }),
    // Everything below exists to make the grid wider than any viewport. Frozen
    // columns are only visible once there is something to scroll past them,
    // and a ten-column demo that fits on screen demonstrates nothing.
    col<Item>({
      id: "warehouse",
      label: "Warehouse",
      type: ColumnTypes.BADGE,
      width: 130,
      groupable: true,
      filterOptions: options(WAREHOUSES),
    }),
    col<Item>({
      id: "status",
      label: "Status",
      type: ColumnTypes.BADGE,
      width: 130,
      groupable: true,
      filterOptions: options(STATUSES),
    }),
    col<Item>({
      id: "unitsOnHand",
      label: "On hand",
      type: ColumnTypes.RAW_NUMBER,
      width: 110,
    }),
    col<Item>({
      id: "reorderPoint",
      label: "Reorder at",
      type: ColumnTypes.RAW_NUMBER,
      width: 115,
    }),
    col<Item>({
      id: "leadTimeDays",
      label: "Lead time",
      type: ColumnTypes.DAYS,
      width: 115,
      thresholds: DAYS_THRESHOLDS,
    }),
    col<Item>({
      id: "returnsRate",
      label: "Returns",
      type: ColumnTypes.PROGRESS,
      width: 120,
      thresholds: QUALITY_THRESHOLDS,
    }),
    col<Item>({
      id: "weightKg",
      label: "Weight",
      type: ColumnTypes.DECIMAL,
      width: 110,
    }),
    col<Item>({
      id: "lastCountedOn",
      label: "Last counted",
      type: ColumnTypes.DATE,
      width: 130,
      groupable: true,
    }),
  ];
}
