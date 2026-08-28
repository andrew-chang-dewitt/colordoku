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
  cumulativeScoreThroughEntry,
} from "../persistence/weeklyScore";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface ScoreViewConfig {
  /**
   * Injectable for tests; defaults to the real persistence/history.ts getHistory.
   */
  getEntries?: () => HistoryEntry[];
  /**
   * Called when the player taps an open chart tooltip: navigates them to the
   * game-history drawer, scrolled/highlighted to that specific entry. Required
   * (not defaulted) since there's no sensible no-op fallback — main.ts wires
   * this to close this drawer and open historyview.ts's with the entry id.
   */
  onViewInHistory: (entryId: string) => void;
}

export interface ScoreView {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
}

export function newScoreView({ getEntries = getHistory, onViewInHistory }: ScoreViewConfig): ScoreView {
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

  // Chart wrapper for line graph
  const chartWrapper = document.createElement("div");
  chartWrapper.className = classes.chartWrapper;
  panel.append(chartWrapper);

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

  /** Short single-date format for axis labels/tooltips, e.g. "Aug 24". */
  function shortDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function render(): void {
    const all = getEntries();

    // Update summary with current week and all-time totals
    const weekBounds = currentWeekBounds();
    const weeklyTotal = weeklyScoreTotal(all, weekBounds);
    const allTimeTotal = allTimeScoreTotal(all);
    summary.textContent = `This week: ${weeklyTotal} · All-time: ${allTimeTotal}`;

    // Group by week (still drives the list of weekly totals below the chart)
    const buckets = groupByWeek(all);

    // Build the per-game, current-week-only chart. Each point is one game,
    // in chronological order (oldest → newest, left → right); its Y value is
    // the running cumulative total *through* that game within its own week
    // (weeklyScore.ts's cumulativeScoreThroughEntry), so the last point always
    // matches the "This week" summary total above.
    chartWrapper.replaceChildren();
    const weekEntries = all
      .filter((e) => e.startedAt >= weekBounds.start && e.startedAt < weekBounds.end)
      .sort((a, b) => a.startedAt - b.startedAt);

    if (weekEntries.length === 0) {
      // Nothing to chart. If there's history at all just elsewhere in time,
      // say so rather than leaving a silently blank wrapper (which reads the
      // same as "chart failed to render" as "no games at all").
      if (all.length > 0) {
        const noGames = document.createElement("p");
        noGames.className = classes.chartEmpty;
        noGames.textContent = "No games played this week yet.";
        chartWrapper.append(noGames);
      }
    } else {
      // Chart dimensions and padding. PAD_X/PAD_Y were widened from the old
      // chart's 30/20 to leave room for the new axis labels below/left of the
      // plot area — exact values are a guess (no browser to check against),
      // may want manual tuning once this actually renders.
      const CHART_W = 600;
      const CHART_H = 200;
      const PAD_X = 40;
      const PAD_Y = 24;

      const n = weekEntries.length;
      const cumulatives = weekEntries.map((e) => cumulativeScoreThroughEntry(all, e));
      const maxTotal = Math.max(1, ...cumulatives);

      const xFor = (i: number) =>
        n === 1 ? CHART_W / 2 : PAD_X + (i * (CHART_W - 2 * PAD_X)) / (n - 1);
      const yFor = (cumulative: number) =>
        PAD_Y + (CHART_H - 2 * PAD_Y) * (1 - cumulative / maxTotal);

      const points = weekEntries.map((entry, i) => ({
        x: xFor(i),
        y: yFor(cumulatives[i]),
        cumulative: cumulatives[i],
        entry,
      }));

      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        `This week's cumulative score across ${n} games, currently ${points[n - 1]?.cumulative ?? 0} points`,
      );

      // Y axis: vertical line + "0" / max labels.
      const yAxis = document.createElementNS(SVG_NS, "line");
      yAxis.setAttribute("x1", String(PAD_X));
      yAxis.setAttribute("y1", String(PAD_Y));
      yAxis.setAttribute("x2", String(PAD_X));
      yAxis.setAttribute("y2", String(CHART_H - PAD_Y));
      yAxis.setAttribute("stroke", "var(--color-border)");
      svg.append(yAxis);

      const yZeroLabel = document.createElementNS(SVG_NS, "text");
      yZeroLabel.setAttribute("x", String(PAD_X - 6));
      yZeroLabel.setAttribute("y", String(CHART_H - PAD_Y));
      yZeroLabel.setAttribute("text-anchor", "end");
      yZeroLabel.setAttribute("font-size", "10");
      yZeroLabel.setAttribute("fill", "var(--color-on-surface)");
      yZeroLabel.textContent = "0";
      svg.append(yZeroLabel);

      const yMaxLabel = document.createElementNS(SVG_NS, "text");
      yMaxLabel.setAttribute("x", String(PAD_X - 6));
      yMaxLabel.setAttribute("y", String(PAD_Y + 4));
      yMaxLabel.setAttribute("text-anchor", "end");
      yMaxLabel.setAttribute("font-size", "10");
      yMaxLabel.setAttribute("fill", "var(--color-on-surface)");
      yMaxLabel.textContent = String(maxTotal);
      svg.append(yMaxLabel);

      // X axis: baseline + date labels. Below LABEL_ALL_THRESHOLD points
      // (one week of games is likely to be well under this) every point gets
      // its own label; beyond that, only the first and last are labeled to
      // avoid overlapping text.
      const xAxis = document.createElementNS(SVG_NS, "line");
      xAxis.setAttribute("x1", String(PAD_X));
      xAxis.setAttribute("y1", String(CHART_H - PAD_Y));
      xAxis.setAttribute("x2", String(CHART_W - PAD_X));
      xAxis.setAttribute("y2", String(CHART_H - PAD_Y));
      xAxis.setAttribute("stroke", "var(--color-border)");
      svg.append(xAxis);

      const LABEL_ALL_THRESHOLD = 7;
      const labelIndices =
        n <= LABEL_ALL_THRESHOLD ? points.map((_, i) => i) : [0, n - 1];
      for (const i of labelIndices) {
        const point = points[i];
        const label = document.createElementNS(SVG_NS, "text");
        label.setAttribute("x", String(point.x));
        label.setAttribute("y", String(CHART_H - PAD_Y + 14));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "10");
        label.setAttribute("fill", "var(--color-on-surface)");
        label.textContent = shortDate(point.entry.startedAt);
        svg.append(label);
      }

      // Polyline connecting the games, if there are 2+.
      if (n >= 2) {
        const polyline = document.createElementNS(SVG_NS, "polyline");
        const pointsStr = points.map((p) => `${p.x},${p.y}`).join(" ");
        polyline.setAttribute("points", pointsStr);
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", "var(--color-queen)");
        polyline.setAttribute("stroke-width", "2");
        svg.append(polyline);
      }

      // Tap-to-show tooltip state: only one open at a time, closed by
      // tapping its own circle again, or replaced by tapping a different one.
      let openTooltip: { entryId: string; group: SVGGElement } | null = null;

      function closeTooltip(): void {
        if (openTooltip) {
          openTooltip.group.remove();
          openTooltip = null;
        }
      }

      function buildTooltip(point: (typeof points)[number]): SVGGElement {
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("class", classes.tooltip);
        g.style.cursor = "pointer";

        const width = 96;
        const height = 34;
        let tx = point.x - width / 2;
        let ty = point.y - height - 10; // default: above the point

        // Clamp horizontally so it never renders outside the viewBox.
        tx = Math.max(2, Math.min(CHART_W - width - 2, tx));
        // Flip below the point if there's no room above; then clamp vertically too.
        if (ty < 2) ty = point.y + 10;
        if (ty + height > CHART_H - 2) ty = Math.max(2, CHART_H - height - 2);

        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", String(tx));
        rect.setAttribute("y", String(ty));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));
        rect.setAttribute("rx", "4");
        rect.setAttribute("fill", "var(--color-surface)");
        rect.setAttribute("stroke", "var(--color-border)");
        g.append(rect);

        const dateText = document.createElementNS(SVG_NS, "text");
        dateText.setAttribute("x", String(tx + width / 2));
        dateText.setAttribute("y", String(ty + 14));
        dateText.setAttribute("text-anchor", "middle");
        dateText.setAttribute("font-size", "10");
        dateText.setAttribute("fill", "var(--color-on-surface)");
        dateText.textContent = shortDate(point.entry.startedAt);
        g.append(dateText);

        const scoreText = document.createElementNS(SVG_NS, "text");
        scoreText.setAttribute("x", String(tx + width / 2));
        scoreText.setAttribute("y", String(ty + 27));
        scoreText.setAttribute("text-anchor", "middle");
        scoreText.setAttribute("font-size", "10");
        scoreText.setAttribute("font-weight", "bold");
        scoreText.setAttribute("fill", "var(--color-on-surface)");
        scoreText.textContent = `${point.cumulative} points`;
        g.append(scoreText);

        // Tapping the tooltip itself (not the circle that opened it)
        // navigates to that game's entry in the history drawer.
        g.addEventListener("click", (event) => {
          event.stopPropagation();
          onViewInHistory(point.entry.id);
        });

        return g;
      }

      for (const point of points) {
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", String(point.x));
        circle.setAttribute("cy", String(point.y));
        circle.setAttribute("r", "4");
        circle.setAttribute("fill", "var(--color-queen)");
        circle.setAttribute("role", "button");
        circle.setAttribute("tabindex", "0");
        circle.setAttribute("class", classes.point);
        circle.style.cursor = "pointer";
        const dateStr = shortDate(point.entry.startedAt);
        circle.setAttribute(
          "aria-label",
          `Game on ${dateStr}, cumulative score ${point.cumulative}`,
        );

        circle.addEventListener("click", (event) => {
          event.stopPropagation();
          if (openTooltip?.entryId === point.entry.id) {
            closeTooltip();
            return;
          }
          closeTooltip();
          const group = buildTooltip(point);
          svg.append(group);
          openTooltip = { entryId: point.entry.id, group };
        });

        svg.append(circle);
      }

      chartWrapper.append(svg);
    }

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
