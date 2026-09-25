import { GridConfigError } from "./errors";
import { parseGridRequest } from "./request";
import type {
  GridRequest,
  GridResult,
  GridSource,
  SqlGridColumn,
} from "./types";

export interface RunGridOptions<TRow extends object> {
  columns: readonly SqlGridColumn<TRow>[];
  count?: boolean;
  /** Application policy, not a value accepted from the request body. Default 1000. */
  maxLimit?: number;
  timeZone?: string;
  signal?: AbortSignal;
}
export async function runGrid<TRow extends object>(
  source: GridSource<TRow>,
  request: GridRequest,
  options: RunGridOptions<TRow>,
): Promise<GridResult<TRow>> {
  options.signal?.throwIfAborted();
  if (options.count !== undefined && typeof options.count !== "boolean")
    throw new GridConfigError("count must be boolean");
  const parsed = parseGridRequest(request, options.columns, {
    maxLimit: options.maxLimit,
  });
  return source.query({
    ...parsed,
    columns: options.columns,
    count: options.count ?? true,
    maxLimit: options.maxLimit,
    timeZone: options.timeZone ?? "UTC",
    signal: options.signal,
  });
}
