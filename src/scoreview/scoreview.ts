/**
 * Score over time view — a <dialog> bottom-sheet drawer showing weekly score
 * buckets from persistence/history.ts's history, with the same house styling
 * as historyview.ts (backdrop-click-to-close, Escape-to-close, translate
 * open animation).
 *
 * Derived purely from persistence/history.ts's getHistory(), no separate
 * storage: week grouping and totals are computed fresh every time this drawer
 * opens (matching historyview.ts's own behavior, so both stay in sync).
 */

import classes from "./scoreview.module.css";
import type { HistoryEntry } from "../persistence/history";
import { getHistory } from "../persistence/history";
import {
  currentWeekBounds,
  weeklyScoreTotal,
  allTimeScoreTotal,
  groupByWeek,
} from "../persistence/weeklyScore";

export interface ScoreViewConfig {
  /**
   * Injectable for tests; defaults to the real persistence/history.ts getHistory.
   */
  getEntries?: () => HistoryEntry[];
}

export interface ScoreView {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
}

export function newScoreView({ getEntries = getHistory }: ScoreViewConfig = {}): ScoreView {
  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const panel = document.createElement("div");
  panel.className = classes.panel;
  html.append(panel);

  // Header with title and close button
  const header = document.createElement("div");
  header.className = classes.header;
  panel.append(header);

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  heading.textContent = "Score over time";
  header.append(heading);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = `btn btn-secondary ${classes.close}`;
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => html.close());
  header.append(closeButton);

  // Summary line: current week total + all-time total
  const summary = document.createElement("div");
  summary.className = classes.summary;
  panel.append(summary);

  // List of weekly buckets
  const list = document.createElement("ul");
  list.className = classes.list;
  panel.append(list);

  // Empty state message
  const emptyState = document.createElement("p");
  emptyState.className = classes.emptyState;
  panel.append(emptyState);

  function formatDateRange(startMs: number, endMs: number): string {
    // Format like "Aug 24 – Aug 30, 2026" or "Aug 25 – Sep 1, 2026"
    const start = new Date(startMs);
    const end = new Date(endMs - 1); // end is exclusive, so go back 1ms

    const startMonth = start.toLocaleString("default", { month: "short" });
    const startDay = start.getDate();
    const endMonth = end.toLocaleString("default", { month: "short" });
    const endDay = end.getDate();
    const year = end.getFullYear();

    // Always include month on both sides for clarity
    return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
  }

  function render(): void {
    const all = getEntries();

    // Update summary with current week and all-time totals
    const weekBounds = currentWeekBounds();
    const weeklyTotal = weeklyScoreTotal(all, weekBounds);
    const allTimeTotal = allTimeScoreTotal(all);
    summary.textContent = `This week: ${weeklyTotal} · All-time: ${allTimeTotal}`;

    // Group by week
    const buckets = groupByWeek(all);

    list.replaceChildren();
    for (const bucket of buckets) {
      const item = document.createElement("li");
      item.className = classes.weekItem;

      const dateRange = document.createElement("span");
      dateRange.className = classes.weekDateRange;
      dateRange.textContent = formatDateRange(bucket.bounds.start, bucket.bounds.end);
      item.append(dateRange);

      const stats = document.createElement("span");
      stats.className = classes.weekStats;
      stats.textContent = `${bucket.total} points · ${bucket.gamesWon} ${bucket.gamesWon === 1 ? "game" : "games"} won`;
      item.append(stats);

      list.append(item);
    }

    list.hidden = buckets.length === 0;
    emptyState.hidden = buckets.length > 0;
    emptyState.textContent = "No games scored yet.";
  }

  html.addEventListener("cancel", (event) => {
    // This is a freely dismissable view, not a forced choice — Escape is allowed.
    void event;
  });

  html.addEventListener("click", (event) => {
    // Same "click landed on the dialog itself == backdrop" trick historyview uses.
    if (event.target === html) html.close();
  });

  return {
    html,

    open() {
      render();
      if (!html.open) html.showModal();
    },

    close() {
      html.close();
    },
  };
}
