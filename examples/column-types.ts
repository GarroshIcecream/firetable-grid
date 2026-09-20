// A reference column catalogue.
//
// The grid ships no catalogue of its own: a column type is how *your* data
// describes itself, so you declare the set your tables need and the engine
// works off it. This file is a worked starting point — copy it, delete what
// you do not need, add your own. Anything satisfying `ColumnType` works.
//
// `satisfies Record<string, ColumnType>` is doing real work here: it type-checks
// every entry while keeping the literal key and value types, so `col()` can
// infer a column's renderer and filter behaviour from the type you hand it.

import type { ColumnType } from "../src";

export const ColumnTypes = {
  INDEX: {
    dataType: "index",
    cellRenderer: "indexCell",
    filterType: null,
    sortable: false,
    groupable: false,
    aggregatable: false,
  },
  TEXT: {
    dataType: "text",
    cellRenderer: "text",
    filterType: "text",
    sortable: true,
    groupable: true,
    aggregatable: false,
  },
  LINK: {
    dataType: "action",
    cellRenderer: "link",
    filterType: null,
    sortable: false,
    groupable: false,
    aggregatable: false,
  },
  BADGE: {
    dataType: "enum",
    cellRenderer: "genericBadge",
    filterType: "enum",
    sortable: true,
    groupable: true,
    aggregatable: false,
    enumColorOptIn: true,
  },
  NUMBER: {
    dataType: "number",
    cellRenderer: "number",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    thresholdOptIn: true,
    sampleValue: 85,
  },
  RAW_NUMBER: {
    dataType: "number",
    cellRenderer: "rawNumber",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    thresholdOptIn: true,
    sampleValue: 42,
  },
  DECIMAL: {
    dataType: "number",
    cellRenderer: "decimal",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    thresholdOptIn: true,
    sampleValue: 8.5,
  },
  CURRENCY: {
    unit: "currency",
    dataType: "number",
    cellRenderer: "currency",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    formatPrefix: "€\u2009",
    thresholdOptIn: true,
  },
  KM: {
    unit: "kilometers",
    dataType: "number",
    cellRenderer: "kmBadge",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    formatSuffix: " km",
    thresholdOptIn: true,
  },
  DAYS: {
    unit: "days",
    dataType: "number",
    cellRenderer: "daysBadge",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    formatSuffix: " d",
    colorByThreshold: true,
    sampleValue: 45,
  },
  DATE: {
    dataType: "date",
    cellRenderer: "date",
    filterType: "date",
    sortable: true,
    groupable: true,
    aggregatable: false,
  },
  TREND: {
    dataType: "number",
    cellRenderer: "trend",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    cellAlignment: "start",
    colorByThreshold: true,
  },
  PROGRESS: {
    unit: "percentage_points",
    dataType: "number",
    cellRenderer: "attentionProgress",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    colorByThreshold: true,
    ratioStored: true,
    sampleValue: 0.55,
  },
  PROGRESS_FLOOR: {
    unit: "percentage_points",
    dataType: "number",
    cellRenderer: "attentionProgress",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: true,
    colorByThreshold: true,
    ratioStored: true,
    ratioFloor: true,
    sampleValue: 0.55,
  },
  ACCURACY: {
    dataType: "enum",
    cellRenderer: "accuracyBadge",
    filterType: "enum",
    sortable: true,
    groupable: true,
    aggregatable: false,
    enumColorOptIn: true,
  },
  LISTING_RATE: {
    unit: "percentage_points",
    // Conversion percent 0..100; averaging rates across rows is
    // statistically wrong, so no footer aggregation.
    dataType: "number",
    cellRenderer: "listingConversion",
    filterType: "numeric",
    sortable: true,
    groupable: false,
    aggregatable: false,
    formatSuffix: "%",
    sampleValue: 2.01,
  },
  EVIDENCE_CHIPS: {
    dataType: "composite",
    cellRenderer: "evidenceChips",
    filterType: null,
    sortable: false,
    groupable: false,
    aggregatable: false,
    enumColorOptIn: true,
    // The row value is the chips' comma-joined evidence codes. Nothing filters
    // on it (filterType is null), but the export has to expand it into the
    // labels the chips show rather than emit the codes.
    setValued: true,
    sampleValue: "PRICE_POSITION",
  },
  RECOMMENDED_ACTIONS: {
    dataType: "enum",
    cellRenderer: "recommendedActions",
    filterType: "enum",
    sortable: false,
    groupable: false,
    aggregatable: false,
    setValued: true,
    // Opting in means the host app supplies the per-value colours at runtime
    // rather than the column type fixing them.
    enumColorOptIn: true,
  },
} as const satisfies Record<string, ColumnType>;
