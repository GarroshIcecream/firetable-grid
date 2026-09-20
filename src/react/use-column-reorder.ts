"use client";

import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  type CategoryResolver,
  moveColumnWithinCategory,
} from "../column-category-layout";

export interface UseColumnReorderOptions {
  order: readonly string[];
  /** Columns a drag may rearrange — typically the visible, unpinned ones. */
  participating: ReadonlySet<string>;
  onOrderChange: (order: string[]) => void;
  /**
   * Buckets a column into a category. A drag may only rearrange within one
   * bucket. Omit it and every column shares a bucket, i.e. free reordering.
   */
  categoryOf?: CategoryResolver;
  enabled?: boolean;
}

const NO_CATEGORY: CategoryResolver = () => undefined;

/**
 * Column reordering on the native HTML5 drag events — no drag-and-drop library.
 *
 * The hook only produces the (active, over) pair; `moveColumnWithinCategory`
 * decides the resulting order, which is what keeps a drag from tearing a column
 * out of its category and silently re-ranking the whole strip.
 */
export function useColumnReorder({
  order,
  participating,
  onOrderChange,
  categoryOf = NO_CATEGORY,
  enabled = false,
}: UseColumnReorderOptions) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // dataTransfer is unreadable during dragover in most browsers, so the active
  // id has to be tracked here as well as put on the event.
  const active = useRef<string | null>(null);

  const reset = useCallback(() => {
    active.current = null;
    setActiveId(null);
    setOverId(null);
  }, []);

  const dragProps = useCallback(
    (id: string) => {
      if (!enabled || !participating.has(id)) return {};
      return {
        draggable: true,
        onDragStart: (e: ReactDragEvent<HTMLElement>) => {
          active.current = id;
          setActiveId(id);
          e.dataTransfer.effectAllowed = "move";
          // Firefox ignores a drag that carries no payload.
          e.dataTransfer.setData("text/plain", id);
        },
        onDragOver: (e: ReactDragEvent<HTMLElement>) => {
          const from = active.current;
          if (!from || from === id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOverId(id);
        },
        onDragLeave: () => {
          setOverId((current) => (current === id ? null : current));
        },
        onDrop: (e: ReactDragEvent<HTMLElement>) => {
          e.preventDefault();
          const from = active.current ?? e.dataTransfer.getData("text/plain");
          reset();
          if (!from || from === id) return;
          const next = moveColumnWithinCategory(
            order,
            participating,
            from,
            id,
            categoryOf,
          );
          // null means the move was refused — a cross-category drop, or an id
          // outside the participating set. Leave the order untouched.
          if (next) onOrderChange(next);
        },
        onDragEnd: reset,
      };
    },
    [enabled, participating, order, categoryOf, onOrderChange, reset],
  );

  return { activeId, overId, dragProps };
}
