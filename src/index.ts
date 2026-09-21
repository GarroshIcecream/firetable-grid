// FireTable Grid — a schema-driven filter/sort/group/export engine for
// TanStack Table, generic over the row type.
//
// Two groups of modules are deliberately absent, both so that importing this
// package costs a client bundle nothing it did not ask for:
//
//   - `xlsx-export` pulls `server-only` and `node:stream`, and ships from the
//     `firetable-grid/server` subpath instead.
//   - `threshold-schema` / `enum-color-schema` pull zod (~388 KB raw), and ship
//     from `firetable-grid/schema`. `threshold.ts` and `enum-color.ts` are
//     zod-free for exactly this reason; re-exporting their schemas here undid
//     it, since a barrel makes every consumer pay for the heaviest member.
//
// Everything exported here is safe in a client bundle.
export * from "./breakdown";
export * from "./client-export";
export * from "./column-category-layout";
export * from "./column-schema";
export * from "./column-vocabulary";
export * from "./csv-export";
export * from "./date-grouping";
export * from "./default-thresholds";
export * from "./derived-options";
export * from "./enum-color";
export * from "./export-cell";
export * from "./filter-engine";
export * from "./footer-aggregate-query";
export * from "./format-footer-aggregate";
export * from "./grid-view";
export * from "./palette";
export * from "./ratio";
export * from "./sort-rows";
export * from "./sorting-state";
export * from "./tanstack";
export * from "./threshold";
export * from "./view-diff";
export * from "./xlsx-client";
export * from "./xlsx-sheet";
