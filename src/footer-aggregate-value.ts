// Which number a footer cell shows.
//
// There are two possible sources and they are not interchangeable. Over paged
// data the loaded rows are a slice, and a sum computed from them drifts further
// from the truth with every page that has not arrived - so when the server has
// computed the aggregate over the whole set, that value wins. This is the one
// place that precedence lives, because a footer showing a confidently wrong
// total is worse than one showing nothing.

import type { AggregationType } from "./column-vocabulary";

/** Server-computed aggregates, keyed by column id then aggregation. */
export type FooterAggregateValues = Readonly<
  Record<string, Partial<Record<AggregationType, number | null>>>
>;

/**
 * The server's value when it has one, else the locally computed value.
 *
 * An explicit `null` from the server is an answer, not a miss: it means "no
 * value over the whole set", and falling through to a local number computed
 * over a different set of rows would contradict it. Presence is therefore
 * tested with `in`, the same distinction `diffView` draws.
 *
 * `computeLocal` is a thunk so the loaded-rows scan never runs when a server
 * value is going to replace it.
 */
export function resolveFooterValue(
  columnId: string,
  aggregation: AggregationType,
  serverValues: FooterAggregateValues | undefined,
  computeLocal: () => number | null,
): number | null {
  const forColumn = serverValues?.[columnId];
  if (forColumn && aggregation in forColumn) {
    return forColumn[aggregation] ?? null;
  }
  return computeLocal();
}
