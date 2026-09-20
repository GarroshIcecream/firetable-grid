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
function relativeBucket(ymd: string, now: Date): number {
  const date = ymdToLocalDate(ymd);
  if (!date) return 4;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86_400_000;
  const diffDays = Math.round((today.getTime() - date.getTime()) / dayMs);
  if (diffDays === 0) return 0;
  if (diffDays === 1) return 1;
  // Monday-based week containing today.
  const dow = (today.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const weekStart = new Date(today.getTime() - dow * dayMs);
  if (
    date.getTime() >= weekStart.getTime() &&
    date.getTime() <= today.getTime()
  ) {
    return 2;
  }
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth()
  ) {
    return 3;
  }
  return 4;
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
  if (!ymd) return { sortKey: "￿", label: labels.none };
  if (mode === "exact") return { sortKey: ymd, label: ymd };
  const bucket = relativeBucket(ymd, now);
  const labelByBucket = [
    labels.today,
    labels.yesterday,
    labels.thisWeek,
    labels.thisMonth,
    labels.older,
  ];
  return { sortKey: String(bucket), label: labelByBucket[bucket] };
}
