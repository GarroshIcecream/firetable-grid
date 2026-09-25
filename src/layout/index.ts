// Layout primitives for rendering the engine's output as a virtualized grid
// with frozen columns.
//
// This is the half a data grid usually reinvents: column widths and sticky
// offsets as CSS custom properties, the flat item list that interleaves group
// headers with rows, sequential row numbering that survives filtering, and the
// per-column cell facts hoisted out of the per-row render loop.
//
// Tailwind class names are returned as strings, so you keep full control of the
// markup. `use-column-resize-preview` is the only module that needs
// `@tanstack/react-virtual`; everything else is dependency-free.
export * from "./aggregates";
export * from "./cell-padding";
export * from "./cell-spec";
export * from "./cell-vertical-align";
export * from "./column-window";
export * from "./geometry";
export * from "./model";
export * from "./row-position";
export * from "./use-column-resize-preview";
export * from "./windowing";
