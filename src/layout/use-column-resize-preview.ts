"use client";

import type {
  columnResizingState as ColumnResizingState,
  RowData,
} from "@tanstack/react-table";
import type { Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useLayoutEffect } from "react";
import type { AppHeader } from "../tanstack";
import { columnLeftProperty, columnSizeProperty } from "./geometry";
import type { ColumnLayoutEntry } from "./model";

export function previewColumnSize<TData extends RowData>(
  entry: ColumnLayoutEntry<AppHeader<TData, unknown>>,
  resizing: ColumnResizingState,
) {
  const start = resizing.columnSizingStart.find(([id]) => id === entry.id)?.[1];
  if (!resizing.isResizingColumn || start === undefined) return entry.size;
  const { minSize = 20, maxSize = Number.MAX_SAFE_INTEGER } =
    entry.item.column.columnDef;
  const proposed =
    Math.round(
      Math.max(start + start * (resizing.deltaPercentage ?? 0), 0) * 100,
    ) / 100;
  return Math.min(Math.max(minSize, proposed), maxSize);
}

// Transient drag geometry stays in CSS; committing preferences per pointer
// frame would invalidate every memoized body cell and its owning workspace.
export function useColumnResizePreview<TData extends RowData>(
  frameRef: RefObject<HTMLDivElement | null>,
  layout: readonly ColumnLayoutEntry<AppHeader<TData, unknown>>[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  firstIndex: number,
  lastIndex: number,
) {
  const table = layout[0]?.item.table;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !table) return;
    const update = () => {
      const resizing = table.atoms.columnResizing.get();
      const sizes = layout.map((entry) => previewColumnSize(entry, resizing));
      let pinned = 0;
      let before = 0;
      let after = 0;
      let index = 0;
      const unpinnedSizes: number[] = [];
      for (let i = 0; i < layout.length; i++) {
        const entry = layout[i];
        const size = sizes[i];
        frame.style.setProperty(columnSizeProperty(entry.id), `${size}px`);
        if (entry.isPinned) {
          frame.style.setProperty(columnLeftProperty(entry.id), `${pinned}px`);
          pinned += size;
        } else {
          if (index < firstIndex) before += size;
          if (index > lastIndex) after += size;
          unpinnedSizes.push(size);
          index++;
        }
      }
      frame.style.setProperty("--ftg-pinned", `${pinned}px`);
      frame.style.setProperty(
        "--ftg-total",
        `${sizes.reduce((sum, size) => sum + size, 0)}px`,
      );
      frame.style.setProperty("--ftg-before", `${before}px`);
      frame.style.setProperty("--ftg-after", `${after}px`);
      const previousWindow = virtualizer.getVirtualIndexes();
      virtualizer.setOptions({ ...virtualizer.options, paddingStart: pinned });
      unpinnedSizes.forEach((size, i) => {
        virtualizer.resizeItem(i, size);
      });
      const nextWindow = virtualizer.getVirtualIndexes();
      if (
        previousWindow[0] !== nextWindow[0] ||
        previousWindow.at(-1) !== nextWindow.at(-1)
      ) {
        virtualizer.options.onChange?.(virtualizer, false);
      }
    };
    update();
    const subscription = table.atoms.columnResizing.subscribe(update);
    return () => subscription.unsubscribe();
  }, [frameRef, layout, table, virtualizer, firstIndex, lastIndex]);
}
