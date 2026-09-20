// Zod validation for the stored grid config — threshold lists and enum colour
// maps as they come back out of a JSONB column or a registry editor.
//
// A separate entry point on purpose. `threshold.ts` and `enum-color.ts` are
// deliberately zod-free because the grid's cell renderers import their
// resolvers on every cell; re-exporting the schemas from `./index` put zod
// (~388 KB raw) back into the client bundle of anything that touched the
// package at all, which is the cost that split was paying to avoid. Import
// them from `firetable-grid/schema`, on the server or in the editors that
// actually parse stored config.
export * from "./enum-color-schema";
export * from "./threshold-schema";
