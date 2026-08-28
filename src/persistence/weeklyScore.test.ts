import { describe, it, expect } from "vitest";
import type { HistoryEntry } from "./history";
import {
  currentWeekBounds,
  weekBoundsFor,
  weeklyScoreTotal,
  allTimeScoreTotal,
  cumulativeScoreThroughEntry,
  groupByWeek,
} from "./weeklyScore";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `entry-${Math.random()}`,
    size: 4,
    seed: 111,
    attempt: 1,
    status: "won",
    elapsedMs: 1000,
    score: 100,
    difficulty: "medium",
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("weekBoundsFor", () => {
  it("returns bounds with start on a Monday at 00:00 and end on the next Monday at 00:00", () => {
    // Use a known date: August 25, 2026 (Sunday)
    // Should roll back to August 24, 2026 (Monday)
    const sundayAug25 = new Date(2026, 7, 25, 12, 0, 0).getTime();
    const bounds = weekBoundsFor(sundayAug25);

    const startDate = new Date(bounds.start);
    const endDate = new Date(bounds.end);

    expect(startDate.getDay()).toBe(1); // Monday
    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);
    expect(startDate.getSeconds()).toBe(0);

    expect(endDate.getDay()).toBe(1); // Monday
    expect(endDate.getHours()).toBe(0);
    expect(endDate.getMinutes()).toBe(0);

    // End is 7 days after start
    expect(endDate.getTime() - startDate.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("Sunday rolls back to the previous Monday, not forward", () => {
    // August 25, 2026 is a Sunday
    // August 24, 2026 is a Monday
    // August 31, 2026 is a Sunday
    const sundayAug25 = new Date(2026, 7, 25, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(sundayAug25);
    const startDate = new Date(bounds.start);
    const startDay = startDate.getDate();

    expect(startDay).toBe(24); // Should be August 24 (Monday), not August 31
  });

  it("entries on Monday at 00:00 are inclusive", () => {
    const mondayAug24 = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(mondayAug24);
    expect(mondayAug24).toBeGreaterThanOrEqual(bounds.start);
    expect(mondayAug24).toBeLessThan(bounds.end);
  });

  it("entries just before next Monday 00:00 are inclusive", () => {
    const sundayAug30 = new Date(2026, 7, 30, 23, 59, 59, 999).getTime();
    const bounds = weekBoundsFor(sundayAug30);
    expect(sundayAug30).toBeGreaterThanOrEqual(bounds.start);
    expect(sundayAug30).toBeLessThan(bounds.end);
  });

  it("entries exactly at next Monday 00:00 are exclusive (belong to next week)", () => {
    // August 31, 2026 is a Monday
    const nextMondayAug31 = new Date(2026, 7, 31, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(new Date(2026, 7, 25).getTime()); // Sunday -> previous Monday
    expect(nextMondayAug31).not.toBeLessThan(bounds.end);
  });
});

describe("currentWeekBounds", () => {
  it("returns the week bounds for today", () => {
    const bounds = currentWeekBounds();
    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(bounds.start);
    expect(now).toBeLessThan(bounds.end);
  });

  it("accepts an optional date parameter", () => {
    const specificDate = new Date(2026, 7, 25); // Sunday
    const bounds = currentWeekBounds(specificDate);
    const startDate = new Date(bounds.start);
    expect(startDate.getDate()).toBe(24); // Should be Monday August 24
  });
});

describe("weeklyScoreTotal", () => {
  it("sums scores for entries in the given week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(mondayStart);

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ startedAt: mondayStart + 3000, score: 150, status: "won" }),
    ];

    expect(weeklyScoreTotal(entries, bounds)).toBe(450);
  });

  it("excludes entries outside the week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(mondayStart);

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart - 10000, score: 200, status: "won" }), // before week
      entry({ startedAt: bounds.end + 1000, score: 150, status: "won" }), // after week
    ];

    expect(weeklyScoreTotal(entries, bounds)).toBe(100);
  });

  it("treats null scores as 0", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(mondayStart);

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: null, status: "playing" }), // null score
      entry({ startedAt: mondayStart + 3000, score: 50, status: "won" }),
    ];

    expect(weeklyScoreTotal(entries, bounds)).toBe(150);
  });

  it("sums scores from won, lost, and abandoned entries", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const bounds = weekBoundsFor(mondayStart);

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 0, status: "lost" }), // lost = 0 score
      entry({ startedAt: mondayStart + 3000, score: 0, status: "abandoned" }), // abandoned = 0 score
    ];

    expect(weeklyScoreTotal(entries, bounds)).toBe(100);
  });
});

describe("allTimeScoreTotal", () => {
  it("sums all scores regardless of date", () => {
    const entries = [
      entry({ startedAt: 1000, score: 100 }),
      entry({ startedAt: 2000, score: 200 }),
      entry({ startedAt: 3000, score: 150 }),
    ];

    expect(allTimeScoreTotal(entries)).toBe(450);
  });

  it("treats null scores as 0", () => {
    const entries = [
      entry({ startedAt: 1000, score: 100 }),
      entry({ startedAt: 2000, score: null }),
      entry({ startedAt: 3000, score: 50 }),
    ];

    expect(allTimeScoreTotal(entries)).toBe(150);
  });

  it("handles empty entries", () => {
    expect(allTimeScoreTotal([])).toBe(0);
  });
});

describe("cumulativeScoreThroughEntry", () => {
  it("returns cumulative score up to and including the given entry within its week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();

    const entries = [
      entry({ id: "1", startedAt: mondayStart + 1000, score: 100 }),
      entry({ id: "2", startedAt: mondayStart + 2000, score: 200 }),
      entry({ id: "3", startedAt: mondayStart + 3000, score: 150 }),
    ];

    const result = cumulativeScoreThroughEntry(entries, entries[1]); // Through entry 2
    expect(result).toBe(300); // 100 + 200
  });

  it("includes only entries up to and including the target entry's timestamp", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();

    const entries = [
      entry({ id: "1", startedAt: mondayStart + 1000, score: 100 }),
      entry({ id: "2", startedAt: mondayStart + 2000, score: 200 }),
      entry({ id: "3", startedAt: mondayStart + 3000, score: 150 }),
    ];

    const result = cumulativeScoreThroughEntry(entries, entries[1]); // Through entry 2
    expect(result).toBe(300); // Entries 1 and 2, not 3
  });

  it("excludes entries from other weeks", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const prevWeekStart = mondayStart - 7 * 24 * 60 * 60 * 1000;

    const entries = [
      entry({ id: "1", startedAt: prevWeekStart + 1000, score: 100 }),
      entry({ id: "2", startedAt: mondayStart + 1000, score: 200 }),
      entry({ id: "3", startedAt: mondayStart + 2000, score: 150 }),
    ];

    const result = cumulativeScoreThroughEntry(entries, entries[2]); // Through entry 3
    expect(result).toBe(350); // Only entries 2 and 3 (same week)
  });

  it("treats null scores as 0", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();

    const entries = [
      entry({ id: "1", startedAt: mondayStart + 1000, score: 100 }),
      entry({ id: "2", startedAt: mondayStart + 2000, score: null }),
      entry({ id: "3", startedAt: mondayStart + 3000, score: 150 }),
    ];

    const result = cumulativeScoreThroughEntry(entries, entries[1]); // Through entry 2
    expect(result).toBe(100); // 100 + null (0)
  });
});

describe("groupByWeek", () => {
  it("groups entries by week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const nextWeekStart = mondayStart + 7 * 24 * 60 * 60 * 1000;

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100 }),
      entry({ startedAt: mondayStart + 2000, score: 200 }),
      entry({ startedAt: nextWeekStart + 1000, score: 300 }),
    ];

    const buckets = groupByWeek(entries);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].total).toBe(300); // Next week (newest first)
    expect(buckets[1].total).toBe(300); // This week (100 + 200)
  });

  it("returns buckets sorted newest first", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const nextWeekStart = mondayStart + 7 * 24 * 60 * 60 * 1000;
    const twoWeeksStart = nextWeekStart + 7 * 24 * 60 * 60 * 1000;

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100 }),
      entry({ startedAt: twoWeeksStart + 1000, score: 300 }),
      entry({ startedAt: nextWeekStart + 1000, score: 200 }),
    ];

    const buckets = groupByWeek(entries);
    expect(buckets[0].total).toBe(300); // Two weeks ago (newest)
    expect(buckets[1].total).toBe(200); // Next week
    expect(buckets[2].total).toBe(100); // This week (oldest)
  });

  it("counts games won in each week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();

    const entries = [
      entry({ startedAt: mondayStart + 1000, status: "won" }),
      entry({ startedAt: mondayStart + 2000, status: "won" }),
      entry({ startedAt: mondayStart + 3000, status: "lost" }),
      entry({ startedAt: mondayStart + 4000, status: "abandoned" }),
    ];

    const buckets = groupByWeek(entries);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].gamesWon).toBe(2);
  });

  it("skips weeks with zero entries (groups only non-empty weeks)", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const twoWeeksStart = mondayStart + 14 * 24 * 60 * 60 * 1000; // Skip a week

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100 }),
      entry({ startedAt: twoWeeksStart + 1000, score: 300 }),
    ];

    const buckets = groupByWeek(entries);
    expect(buckets).toHaveLength(2);
    // No bucket for the empty week in between
  });

  it("handles empty entry list", () => {
    const buckets = groupByWeek([]);
    expect(buckets).toHaveLength(0);
  });

  it("includes bounds in each bucket", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [entry({ startedAt: mondayStart + 1000 })];

    const buckets = groupByWeek(entries);
    expect(buckets[0].bounds.start).toBe(mondayStart);
    expect(buckets[0].bounds.end).toBe(mondayStart + 7 * 24 * 60 * 60 * 1000);
  });
});
