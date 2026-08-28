/**
 * Cumulative weekly score tracking — pure aggregation functions over
 * persistence/history.ts's HistoryEntry array, with no separate storage
 * (following the "derive, don't duplicate" principle).
 *
 * Week definition: a week runs from Monday 00:00 to Sunday 23:59:59.999...,
 * in local time. The week *boundaries* are stored as epoch milliseconds, with
 * the end exclusive (the start of the next Monday is the end of this week), so
 * a test for "does this timestamp fall in this week" is simply
 * `timestamp >= bounds.start && timestamp < bounds.end`.
 */

import type { HistoryEntry } from "./history";

export interface WeekBounds {
  start: number; // epoch ms, Monday 00:00 local time (inclusive)
  end: number; // epoch ms, next Monday 00:00 local time (exclusive)
}

/**
 * Computes the start of the week (Monday 00:00 local time) for any given date.
 * Handles edge cases like Sunday (rolls back to the previous Monday, not forward).
 */
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() - ((day + 6) % 7)); // back up to Monday
  return d;
}

/**
 * Returns the week boundaries (start and end) that contain the given date.
 * The end is exclusive (start of the next Monday).
 */
export function currentWeekBounds(now: Date = new Date()): WeekBounds {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return {
    start: start.getTime(),
    end: end.getTime(),
  };
}

/**
 * Returns the week boundaries for the week containing the given timestamp (epoch ms).
 * The end is exclusive (start of the next Monday).
 */
export function weekBoundsFor(timestampMs: number): WeekBounds {
  const date = new Date(timestampMs);
  return currentWeekBounds(date);
}

/**
 * Sum of entry.score (null treated as 0) for entries whose startedAt falls
 * in [bounds.start, bounds.end). Used to compute the total score for a
 * specific week.
 */
export function weeklyScoreTotal(entries: HistoryEntry[], bounds: WeekBounds): number {
  return entries
    .filter((e) => e.startedAt >= bounds.start && e.startedAt < bounds.end)
    .reduce((sum, e) => sum + (e.score ?? 0), 0);
}

/**
 * Sum of all entries' scores, treating null scores as 0. No week filtering.
 * Used for all-time totals.
 */
export function allTimeScoreTotal(entries: HistoryEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.score ?? 0), 0);
}

/**
 * This entry's week's running total, counting every entry in that same week
 * with startedAt <= this entry's startedAt (inclusive of itself). Used for
 * history-view's per-row "running total" column — independent of current
 * sort/filter, since it's a fact about the entry's own week, not about list
 * position.
 */
export function cumulativeScoreThroughEntry(
  entries: HistoryEntry[],
  entry: HistoryEntry,
): number {
  const bounds = weekBoundsFor(entry.startedAt);
  return entries
    .filter(
      (e) =>
        e.startedAt >= bounds.start &&
        e.startedAt < bounds.end &&
        e.startedAt <= entry.startedAt,
    )
    .reduce((sum, e) => sum + (e.score ?? 0), 0);
}

/**
 * Buckets all entries by the week containing their startedAt, newest week
 * first, skipping weeks with zero entries. Each bucket includes the total
 * score for that week and the count of games won in that week.
 */
export interface WeeklyBucket {
  bounds: WeekBounds;
  total: number;
  gamesWon: number;
}

export function groupByWeek(entries: HistoryEntry[]): WeeklyBucket[] {
  // Group entries by week
  const weekMap = new Map<number, HistoryEntry[]>();

  for (const entry of entries) {
    const bounds = weekBoundsFor(entry.startedAt);
    const key = bounds.start; // Use start time as the key
    if (!weekMap.has(key)) {
      weekMap.set(key, []);
    }
    weekMap.get(key)!.push(entry);
  }

  // Convert to WeeklyBucket array, sorted newest first
  const buckets: WeeklyBucket[] = Array.from(weekMap.entries())
    .map(([, weekEntries]) => ({
      bounds: weekBoundsFor(weekEntries[0].startedAt),
      total: weekEntries.reduce((sum, e) => sum + (e.score ?? 0), 0),
      gamesWon: weekEntries.filter((e) => e.status === "won").length,
    }))
    .sort((a, b) => b.bounds.start - a.bounds.start);

  return buckets;
}
