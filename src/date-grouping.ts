// Date helpers for grouping and filtering DATE columns. Pure + dependency-free
// so it unit-tests directly and works regardless of whether a value still
// carries a time component (e.g. before the FIRST/LAST_OCCURENCE retype lands
// on prod) - everything keys off the YYYY-MM-DD prefix.

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

const YMD_RE = /^(\d{4}-\d{2}-\d{2})/;

// Normalize any date-ish value to its calendar day (YYYY-MM-DD), or "" when it
// has no recognizable date. Accepts date strings, ISO datetimes, and Dates.
export function toYmd(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? "" : raw.toISOString().slice(0, 10);
  }
  const m = String(raw).match(YMD_RE);
  return m ? m[1] : "";
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Bucket index (0 = most recent) for relative grouping, computed in local time
// against `now`. Used as the sort key so buckets order by recency, not
// alphabetically by label.
function relativeBucket(ymd: string, now: Date): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
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
