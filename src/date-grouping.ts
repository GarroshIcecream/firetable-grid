// Date helpers for grouping and filtering DATE columns. Pure + dependency-free
// so it unit-tests directly and works regardless of whether a value still
// carries a time component (e.g. before the FIRST/LAST_OCCURENCE retype lands
// on prod) - everything keys off the YYYY-MM-DD prefix.
//
// One rule, everywhere: a value's calendar day is LOCAL. A string contributes
// its literal YYYY-MM-DD prefix (no reinterpretation, so an instant never
// slides a day); a Date contributes its local calendar day. `relativeBucket`
// below compares against a local `now`, and ExcelJS writes a Date at its local
// wall clock, so keying off UTC anywhere here would put those two a day apart.

export type DateGroupMode = "exact" | "relative";

// Localized labels for relative buckets, supplied by the caller (next-intl in
// the app, plain strings in tests) so this module stays pure and i18n-free.
export interface RelativeLabels {
  today: string;
  yesterday: string;
  thisWeek: string;
  thisMonth: string;
  older: string;
  none: string;
}

const ZERO = 48; // "0"
const NINE = 57; // "9"
const DASH = 45; // "-"

/** Does `text` open with a well-formed YYYY-MM-DD? Hand-rolled against
 *  a `/^\d{4}-\d{2}-\d{2}/` match because this runs once per row per date column - on a filter, a
 *  grouping and every exported date cell - and a regex match allocates a
 *  result array per call where a character scan allocates nothing. */
function hasYmdPrefix(text: string): boolean {
  if (text.length < 10) return false;
  for (let i = 0; i < 10; i++) {
    const code = text.charCodeAt(i);
    if (i === 4 || i === 7) {
      if (code !== DASH) return false;
    } else if (code < ZERO || code > NINE) {
      return false;
    }
  }
  return true;
}

/** A Date's LOCAL calendar day as YYYY-MM-DD. `toISOString().slice(0, 10)`
 *  is the UTC day, which is a different day for most of the clock east and
 *  west of Greenwich - local midnight in UTC+2 is the previous day in UTC. */
export function toLocalYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local midnight on `ymd`. `new Date("2026-09-20")` parses as UTC midnight,
 *  which reads back as the 19th anywhere west of Greenwich. */
export function ymdToLocalDate(ymd: string): Date | null {
  if (!isYmd(ymd)) return null;
  // Digit arithmetic rather than `ymd.split("-").map(Number)`: `isYmd` has
  // already proved every character, and this runs once per row per date column
  // on the export and grouping paths, where the split's two arrays per call
  // are pure garbage.
  const year =
    (ymd.charCodeAt(0) - ZERO) * 1000 +
    (ymd.charCodeAt(1) - ZERO) * 100 +
    (ymd.charCodeAt(2) - ZERO) * 10 +
    (ymd.charCodeAt(3) - ZERO);
  const month = (ymd.charCodeAt(5) - ZERO) * 10 + (ymd.charCodeAt(6) - ZERO);
  const day = (ymd.charCodeAt(8) - ZERO) * 10 + (ymd.charCodeAt(9) - ZERO);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Normalize any date-ish value to its calendar day (YYYY-MM-DD), or "" when it
// has no recognizable date. Accepts date strings, ISO datetimes, and Dates.
export function toYmd(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? "" : toLocalYmd(raw);
  }
  const text = typeof raw === "string" ? raw : String(raw);
  if (!hasYmdPrefix(text)) return "";
  // Already exactly a calendar day: hand back the same string rather than an
  // identical copy, so the common case allocates nothing at all.
  return text.length === 10 ? text : text.slice(0, 10);
}

export function isYmd(value: string): boolean {
  return value.length === 10 && hasYmdPrefix(value);
}

// Bucket index (0 = most recent) for relative grouping, computed in local time
// against `now`. Used as the sort key so buckets order by recency, not
// alphabetically by label.
/**
 * Days since 1970-01-01 for a civil (proleptic Gregorian) date - Howard
 * Hinnant's `days_from_civil`.
 *
 * Integer arithmetic, no `Date`, and deliberately no timezone: by the time a
 * value reaches here `toYmd` has already resolved the module's one rule - a
 * value's calendar day is its LOCAL day - so what is left is pure calendar
 * counting. Comparing day NUMBERS also removes the `Math.round` the previous
 * version needed: local midnights either side of a DST transition are not
 * 86,400,000 ms apart, and dividing by that had to round back to a whole day.
 */
function civilDayNumber(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12; // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Everything about `now` that bucketing needs, as day numbers. */
interface RelativeWindow {
  todayDays: number;
  /** Monday of the week containing today. */
  weekStartDays: number;
  year: number;
  month: number;
}

/**
 * Single-slot memo for the window, keyed on the instant.
 *
 * `dateGroupValue` takes `now` per call but a grouping pass holds it fixed, so
 * this is derived once per pass instead of 300,000 times. `getFullYear`,
 * `getMonth`, `getDate` and `getDay` each convert to local time, which is why
 * four of them per row was worth removing.
 *
 * Module-level mutable state, deliberately: it caches nothing but a derivation
 * of its own key, so a miss recomputes and no caller can ever be handed
 * another's data - the concern that makes shared state dangerous elsewhere in
 * this package. Concurrent passes with different `now` values thrash the slot
 * and stay correct.
 */
let windowCache: { key: number; window: RelativeWindow } | null = null;

function relativeWindow(now: Date): RelativeWindow {
  const key = now.getTime();
  if (windowCache !== null && windowCache.key === key) {
    return windowCache.window;
  }
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const todayDays = civilDayNumber(year, month, now.getDate());
  const dow = (now.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const window: RelativeWindow = {
    todayDays,
    weekStartDays: todayDays - dow,
    year,
    month,
  };
  windowCache = { key, window };
  return window;
}

/**
 * Bucket index (0 = most recent), allocating nothing.
 *
 * PRECONDITION: `ymd` is a well-formed YYYY-MM-DD. `dateGroupValue` is the
 * only caller and reaches here only when `toYmd` returned one, so every
 * character is already proved - an `isYmd` guard here scanned the same ten
 * characters a second time on every row.
 */
function relativeBucket(ymd: string, now: Date): number {
  // Digit arithmetic rather than `split("-").map(Number)`: no allocation on
  // the per-row path.
  const year =
    (ymd.charCodeAt(0) - ZERO) * 1000 +
    (ymd.charCodeAt(1) - ZERO) * 100 +
    (ymd.charCodeAt(2) - ZERO) * 10 +
    (ymd.charCodeAt(3) - ZERO);
  const month = (ymd.charCodeAt(5) - ZERO) * 10 + (ymd.charCodeAt(6) - ZERO);
  const day = (ymd.charCodeAt(8) - ZERO) * 10 + (ymd.charCodeAt(9) - ZERO);

  const window = relativeWindow(now);
  const rowDays = civilDayNumber(year, month, day);
  const diffDays = window.todayDays - rowDays;
  if (diffDays === 0) return 0;
  if (diffDays === 1) return 1;
  if (rowDays >= window.weekStartDays && rowDays <= window.todayDays) return 2;
  if (year === window.year && month === window.month) return 3;
  return 4;
}

/** Sort keys for the five relative buckets. Module-level so the per-row path
 *  does not call `String(bucket)` for one of five known answers. */
const RELATIVE_SORT_KEYS = ["0", "1", "2", "3", "4"] as const;

/** Sorts after every real day, so undated rows group last. */
const NONE_SORT_KEY = "\uffff";

function relativeLabel(labels: RelativeLabels, bucket: number): string {
  switch (bucket) {
    case 0:
      return labels.today;
    case 1:
      return labels.yesterday;
    case 2:
      return labels.thisWeek;
    case 3:
      return labels.thisMonth;
    default:
      return labels.older;
  }
}

// Resolve a row's raw date value into a { sortKey, label } pair for grouping.
// `sortKey` drives both group identity (collapse) and ordering; `label` is the
// display text. Missing dates sort last under a single "none" group.
export function dateGroupValue(
  raw: unknown,
  mode: DateGroupMode,
  now: Date,
  labels: RelativeLabels,
): { sortKey: string; label: string } {
  const ymd = toYmd(raw);
  if (!ymd) return { sortKey: NONE_SORT_KEY, label: labels.none };
  if (mode === "exact") return { sortKey: ymd, label: ymd };
  // Neither a lookup array nor a `String()` call per row - see
  // `RELATIVE_SORT_KEYS` and `relativeLabel`.
  const bucket = relativeBucket(ymd, now);
  return {
    sortKey: RELATIVE_SORT_KEYS[bucket],
    label: relativeLabel(labels, bucket),
  };
}
