"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { columnLeftProperty, columnSizeProperty } from "../layout";

export interface ResizeTarget {
  readonly id: string;
  readonly size: number;
  readonly minWidth: number;
  readonly isPinned: boolean;
}

export interface UseColumnResizeOptions {
  /** The element carrying the `--ftg-*` custom properties. */
  frameRef: RefObject<HTMLElement | null>;
  columns: readonly ResizeTarget[];
  /** Committed on pointer-up, not per frame. */
  onCommit?: (sizes: Record<string, number>) => void;
  enabled?: boolean;
  /** Keeps a column virtualizer in sync during pointer previews. */
  onPreview?: (sizes: ReadonlyMap<string, number>) => void;
}

/** Upper bound for a dragged column. A column past this is a layout accident. */
export const MAX_COLUMN_WIDTH = 1200;

/** Pure size resolution, so the drag maths is testable without a pointer. */
export function clampColumnSize(
  proposed: number,
  minWidth: number,
  maxWidth: number = MAX_COLUMN_WIDTH,
): number {
  // min wins over max when they cross, so a column never collapses to nothing.
  return Math.max(minWidth, Math.min(maxWidth, proposed));
}

/**
 * Pointer-driven column resizing.
 *
 * The drag writes widths straight to CSS custom properties on the frame.
 * An optional preview callback lets column virtualization update its window
 * while memoized cell content stays intact. Sizes commit on pointer-up.
 */
export function useColumnResize({
  frameRef,
  columns,
  onCommit,
  onPreview,
  enabled = true,
}: UseColumnResizeOptions) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Read inside pointer handlers that are bound once, so they must not close
  // over a stale render's columns.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;

  /** Re-derive every pinned column's sticky offset from the live sizes. */
  const writeOffsets = useCallback(
    (sizes: Map<string, number>, currentColumns = columnsRef.current) => {
      const frame = frameRef.current;
      if (!frame) return;
      let left = 0;
      let total = 0;
      for (const column of currentColumns) {
        const size = sizes.get(column.id) ?? column.size;
        total += size;
        frame.style.setProperty(columnSizeProperty(column.id), `${size}px`);
        if (column.isPinned) {
          frame.style.setProperty(columnLeftProperty(column.id), `${left}px`);
          left += size;
        }
      }
      frame.style.setProperty("--ftg-pinned", `${left}px`);
      frame.style.setProperty("--ftg-total", `${total}px`);
    },
    [frameRef],
  );

  // Keep the properties in step when columns are reordered, hidden or resized
  // from outside a drag.
  useEffect(() => {
    writeOffsets(new Map(), columns);
  }, [writeOffsets, columns]);

  const onResizeStart = useCallback(
    (id: string, event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const column = columnsRef.current.find((c) => c.id === id);
      if (!column) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startSize = column.size;
      const sizes = new Map<string, number>();
      setActiveId(id);

      const move = (e: PointerEvent) => {
        const next = clampColumnSize(
          startSize + (e.clientX - startX),
          column.minWidth,
        );
        sizes.set(id, next);
        writeOffsets(sizes);
        previewRef.current?.(new Map(sizes));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        setActiveId(null);
        previewRef.current?.(new Map());
        const size = sizes.get(id);
        if (size !== undefined && size !== startSize) {
          commitRef.current?.({ [id]: size });
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [enabled, writeOffsets],
  );

  /** Keyboard equivalent, so a resize is not pointer-only. */
  const onResizeKeyDown = useCallback(
    (id: string, event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const step = event.shiftKey ? 32 : 8;
      const delta =
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0;
      if (delta === 0) return;
      const column = columnsRef.current.find((c) => c.id === id);
      if (!column) return;
      event.preventDefault();
      const next = clampColumnSize(column.size + delta, column.minWidth);
      if (next !== column.size) commitRef.current?.({ [id]: next });
    },
    [enabled],
  );

  return { activeId, onResizeStart, onResizeKeyDown };
}
