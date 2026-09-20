const OTHER = "other";

// The resolver already returns a bucketed category; this only guards a missing
// one, so the module stays free of the vocabulary itself.
function normalise(category: string | null | undefined): string {
  return category ?? OTHER;
}

export interface CategoryBlock {
  category: string;
  startIndex: number;
  endIndex: number;
}

export type CategoryResolver = (id: string) => string | null | undefined;

function rankCategories(
  ids: readonly string[],
  categoryOf: CategoryResolver,
): Map<string, number> {
  const rank = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const category = normalise(categoryOf(ids[i]));
    if (!rank.has(category)) rank.set(category, rank.size);
  }
  return rank;
}

export function groupIdsByCategory(
  ids: readonly string[],
  categoryOf: CategoryResolver,
): string[] {
  const rank = rankCategories(ids, categoryOf);
  const buckets: string[][] = Array.from({ length: rank.size }, () => []);
  for (const id of ids) {
    const index = rank.get(normalise(categoryOf(id)));
    if (index !== undefined) buckets[index].push(id);
  }
  return buckets.flat();
}

// The grouped order is written back into the exact slots its members already
// occupied, so ids that do not take part - pinned columns, hidden columns -
// keep their stored index, and the position of each category's first member is
// preserved. That second property is what keeps category order stable: it is
// derived from first occurrence, so a move that shifted a foreign id into slot
// zero would reshuffle the whole strip.
function rewriteSlots(
  order: readonly string[],
  slots: readonly number[],
  ids: readonly string[],
): string[] {
  const next = [...order];
  for (let i = 0; i < slots.length; i++) next[slots[i]] = ids[i];
  return next;
}

function slotsOf(
  order: readonly string[],
  participating: ReadonlySet<string>,
): { slots: number[]; ids: string[] } {
  const slots: number[] = [];
  const ids: string[] = [];
  for (let i = 0; i < order.length; i++) {
    if (!participating.has(order[i])) continue;
    slots.push(i);
    ids.push(order[i]);
  }
  return { slots, ids };
}

export function projectIdsByCategory(
  order: readonly string[],
  participating: ReadonlySet<string>,
  categoryOf: CategoryResolver,
): string[] {
  const { slots, ids } = slotsOf(order, participating);
  if (ids.length === 0) return [...order];
  return rewriteSlots(order, slots, groupIdsByCategory(ids, categoryOf));
}

export function buildCategoryBlocks(
  ids: readonly string[],
  categoryOf: CategoryResolver,
): CategoryBlock[] {
  const blocks: CategoryBlock[] = [];
  for (let i = 0; i < ids.length; i++) {
    const category = normalise(categoryOf(ids[i]));
    const last = blocks[blocks.length - 1];
    if (last && last.category === category) last.endIndex = i;
    else blocks.push({ category, startIndex: i, endIndex: i });
  }
  return blocks;
}

export interface WindowedCategoryBlock extends CategoryBlock {
  spanned: number;
  showLeadingEdge: boolean;
}

// Blocks live over the FULL strip; only the part inside the virtual window is
// rendered, so `spanned` is the intersection, not the block's real width. The
// leading hairline is suppressed for a block whose start is left of the window
// (with overscan, drawing it would put a divider mid-category) and for the very
// first block, where the frozen zone's own edge already draws that line.
export function windowCategoryBlocks(
  blocks: readonly CategoryBlock[],
  firstIndex: number,
  lastIndex: number,
): WindowedCategoryBlock[] {
  if (blocks.length === 0 || lastIndex < firstIndex) return [];
  return blocks.flatMap((block) => {
    const start = Math.max(block.startIndex, firstIndex);
    const end = Math.min(block.endIndex, lastIndex);
    if (end < start) return [];
    return [
      {
        ...block,
        spanned: end - start + 1,
        showLeadingEdge: block.startIndex > 0 && block.startIndex >= firstIndex,
      },
    ];
  });
}

export function sameCategory(
  a: string,
  b: string,
  categoryOf: CategoryResolver,
): boolean {
  return normalise(categoryOf(a)) === normalise(categoryOf(b));
}

export function moveColumnWithinCategory(
  order: readonly string[],
  participating: ReadonlySet<string>,
  activeId: string,
  overId: string,
  categoryOf: CategoryResolver,
): string[] | null {
  if (activeId === overId) return null;
  if (!sameCategory(activeId, overId, categoryOf)) return null;
  const category = normalise(categoryOf(activeId));
  // Intersected with `participating`, or a pinned or hidden column of the same
  // category joins the slot rewrite and lands on a slot that is not its own -
  // which moves the category's first occurrence and re-ranks the whole strip.
  const members = new Set(
    order.filter(
      (id) => participating.has(id) && normalise(categoryOf(id)) === category,
    ),
  );
  if (!members.has(activeId) || !members.has(overId)) return null;

  const { slots, ids } = slotsOf(order, members);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  const moved = [...ids];
  moved.splice(from, 1);
  moved.splice(to, 0, activeId);
  return rewriteSlots(order, slots, moved);
}

export function moveCategoryBlock(
  order: readonly string[],
  participating: ReadonlySet<string>,
  activeCategory: string,
  overCategory: string,
  categoryOf: CategoryResolver,
): string[] | null {
  if (activeCategory === overCategory) return null;
  const { slots, ids } = slotsOf(order, participating);
  if (ids.length === 0) return null;

  const categories = [...rankCategories(ids, categoryOf).keys()];
  const from = categories.indexOf(activeCategory);
  const to = categories.indexOf(overCategory);
  if (from === -1 || to === -1) return null;

  const reordered = [...categories];
  reordered.splice(from, 1);
  reordered.splice(to, 0, activeCategory);

  const byCategory = new Map<string, string[]>();
  for (const id of ids) {
    const category = normalise(categoryOf(id));
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(id);
    else byCategory.set(category, [id]);
  }
  return rewriteSlots(
    order,
    slots,
    reordered.flatMap((category) => byCategory.get(category) ?? []),
  );
}
