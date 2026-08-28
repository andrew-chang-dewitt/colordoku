import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../persistence/history";
import { newScoreView } from "./scoreview";

let nextId = 0;
function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  nextId += 1;
  return {
    id: `entry-${nextId}`,
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

describe("newScoreView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function mount(entries: HistoryEntry[], onViewInHistory = vi.fn()) {
    const view = newScoreView({ getEntries: () => entries, onViewInHistory });
    document.body.append(view.html);
    return { view, onViewInHistory };
  }

  it("shows an empty-state message when there is no history at all", () => {
    const { view } = mount([]);
    view.open();
    const empty = view.html.querySelector("p.emptyState, p");
    expect(empty).toBeDefined();
  });

  it("shows the weekly and all-time score totals in a summary line", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ startedAt: mondayStart - 10000, score: 50, status: "won" }), // previous week
    ];
    const { view } = mount(entries);
    view.open();

    const summaryDiv = Array.from(view.html.querySelectorAll("div")).find((d) =>
      d.textContent?.includes("This week:"),
    );
    expect(summaryDiv).toBeDefined();
    expect(summaryDiv?.textContent).toContain("This week: 300");
    expect(summaryDiv?.textContent).toContain("All-time: 350");
  });

  it("groups entries by week and shows newest week first in the list below the chart", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const nextWeekStart = mondayStart + 7 * 24 * 60 * 60 * 1000;

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100 }),
      entry({ startedAt: mondayStart + 2000, score: 200 }),
      entry({ startedAt: nextWeekStart + 1000, score: 300 }),
    ];
    const { view } = mount(entries);
    view.open();

    const weekItems = view.html.querySelectorAll("ul > li");
    expect(weekItems).toHaveLength(2);
    // Newest week first (nextWeekStart)
    expect(weekItems[0].textContent).toContain("300 points");
    // Older week
    expect(weekItems[1].textContent).toContain("300 points"); // 100 + 200
  });

  it("shows date ranges for each week in the format 'Mon DD – Sun DD, YYYY'", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [entry({ startedAt: mondayStart + 1000, score: 100 })];
    const { view } = mount(entries);
    view.open();

    const weekItem = view.html.querySelector("ul > li");
    expect(weekItem?.textContent).toContain("Aug 24 – Aug 30, 2026");
  });

  it("shows games won count for each week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ startedAt: mondayStart + 3000, score: 0, status: "lost" }),
    ];
    const { view } = mount(entries);
    view.open();

    const weekItem = view.html.querySelector("ul > li");
    expect(weekItem?.textContent).toContain("2 games won");
  });

  it("shows singular 'game' for 1 game won", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [entry({ startedAt: mondayStart + 1000, score: 100, status: "won" })];
    const { view } = mount(entries);
    view.open();

    const weekItem = view.html.querySelector("ul > li");
    expect(weekItem?.textContent).toContain("1 game won");
  });

  it("opens the dialog as a modal; close()/backdrop click close it", () => {
    const { view } = mount([entry()]);
    view.open();
    expect(view.html.open).toBe(true);

    view.close();
    expect(view.html.open).toBe(false);
  });

  it("closes on a backdrop click but not on a click inside the panel", () => {
    const { view } = mount([entry()]);
    view.open();

    const panel = view.html.firstElementChild!;
    panel.dispatchEvent(new Event("click", { bubbles: true }));
    expect(view.html.open, "a click inside the panel should not close it").toBe(true);

    view.html.dispatchEvent(new Event("click", { bubbles: true }));
    expect(view.html.open).toBe(false);
  });

  it("re-reads getEntries() fresh every time open() is called", () => {
    let entries: HistoryEntry[] = [entry({ score: 100 })];
    const view = newScoreView({ getEntries: () => entries, onViewInHistory: vi.fn() });
    document.body.append(view.html);

    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);

    const nextWeekStart = new Date(2026, 7, 31, 0, 0, 0).getTime();
    entries = [entry({ score: 100 }), entry({ startedAt: nextWeekStart, score: 200 })];
    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("close button clicks close the dialog", () => {
    const { view } = mount([entry()]);
    view.open();
    expect(view.html.open).toBe(true);

    const closeBtn = view.html.querySelector("button.btn-secondary");
    (closeBtn as HTMLButtonElement).click();
    expect(view.html.open).toBe(false);
  });

  describe("chart (per-game, current calendar week only)", () => {
    // Fix "now" to a specific moment inside the week of Mon Aug 24 2026 so
    // currentWeekBounds() in the component under test lines up with the
    // fixtures below (Mon Aug 24 00:00 through Sun Aug 30 23:59:59.999).
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 26, 12, 0, 0));
    });

    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const prevWeekStart = mondayStart - 7 * 24 * 60 * 60 * 1000;

    function restoreTimers() {
      vi.useRealTimers();
    }

    it("does not render an SVG chart when there is no history at all", () => {
      const { view } = mount([]);
      view.open();
      const svg = view.html.querySelector("svg");
      expect(svg).toBeNull();
      restoreTimers();
    });

    it("does not render an SVG chart when history exists but none of it is this week", () => {
      const entries = [entry({ startedAt: prevWeekStart + 1000, score: 100 })];
      const { view } = mount(entries);
      view.open();
      expect(view.html.querySelector("svg")).toBeNull();
      expect(view.html.textContent).toContain("No games played this week yet.");
      restoreTimers();
    });

    it("renders one circle per game played this week, ignoring games from other weeks", () => {
      const entries = [
        entry({ startedAt: mondayStart + 1000, score: 100 }),
        entry({ startedAt: mondayStart + 2000, score: 200 }),
        entry({ startedAt: prevWeekStart + 1000, score: 999 }), // excluded
      ];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg");
      expect(svg).toBeDefined();
      const circles = svg?.querySelectorAll("circle");
      expect(circles).toHaveLength(2);
      restoreTimers();
    });

    it("renders a single circle and no polyline for exactly one game this week", () => {
      const entries = [entry({ startedAt: mondayStart + 1000, score: 100 })];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg");
      const circles = svg?.querySelectorAll("circle");
      expect(circles).toHaveLength(1);
      expect(svg?.querySelector("polyline")).toBeNull();
      restoreTimers();
    });

    it("renders a polyline connecting 2+ games this week", () => {
      const entries = [
        entry({ startedAt: mondayStart + 1000, score: 100 }),
        entry({ startedAt: mondayStart + 2000, score: 200 }),
      ];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg");
      const polyline = svg?.querySelector("polyline");
      expect(polyline).toBeDefined();
      const pointsStr = polyline?.getAttribute("points");
      expect(pointsStr).toMatch(/\d+\.?\d*,\d+\.?\d* \d+\.?\d*,\d+\.?\d*/);
      restoreTimers();
    });

    it("includes every game regardless of status, using cumulative score as the Y value", () => {
      const entries = [
        entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
        entry({ startedAt: mondayStart + 2000, score: 0, status: "lost" }),
      ];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg");
      const circles = svg?.querySelectorAll("circle");
      expect(circles).toHaveLength(2);
      restoreTimers();
    });

    it("gives each circle an accessible label with date and cumulative score", () => {
      const entries = [entry({ startedAt: mondayStart + 1000, score: 100 })];
      const { view } = mount(entries);
      view.open();

      const circle = view.html.querySelector("svg circle");
      expect(circle?.getAttribute("role")).toBe("button");
      expect(circle?.getAttribute("aria-label")).toContain("cumulative score 100");
      restoreTimers();
    });

    it("clicking a circle shows a tooltip with date and cumulative score", () => {
      const entries = [entry({ startedAt: mondayStart + 1000, score: 100 })];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg")!;
      expect(svg.querySelector("g")).toBeNull();

      const circle = svg.querySelector("circle")!;
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const tooltip = svg.querySelector("g");
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain("100 points");
      restoreTimers();
    });

    it("clicking the same circle again hides the tooltip", () => {
      const entries = [entry({ startedAt: mondayStart + 1000, score: 100 })];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg")!;
      const circle = svg.querySelector("circle")!;
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(svg.querySelector("g")).not.toBeNull();

      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(svg.querySelector("g")).toBeNull();
      restoreTimers();
    });

    it("clicking a different circle switches the open tooltip", () => {
      const entries = [
        entry({ startedAt: mondayStart + 1000, score: 100 }),
        entry({ startedAt: mondayStart + 2000, score: 200 }),
      ];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg")!;
      const circles = svg.querySelectorAll("circle");
      circles[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(svg.querySelectorAll("g")).toHaveLength(1);
      expect(svg.querySelector("g")?.textContent).toContain("100 points");

      circles[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(svg.querySelectorAll("g")).toHaveLength(1);
      expect(svg.querySelector("g")?.textContent).toContain("300 points"); // cumulative 100+200
      restoreTimers();
    });

    it("clicking the open tooltip calls onViewInHistory with that game's entry id", () => {
      const target = entry({ startedAt: mondayStart + 1000, score: 100 });
      const entries = [target];
      const { view, onViewInHistory } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg")!;
      const circle = svg.querySelector("circle")!;
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const tooltip = svg.querySelector("g")!;
      tooltip.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onViewInHistory).toHaveBeenCalledWith(target.id);
      restoreTimers();
    });

    it("has an aria-label describing this week's cumulative score", () => {
      const entries = [
        entry({ startedAt: mondayStart + 1000, score: 100 }),
        entry({ startedAt: mondayStart + 2000, score: 200 }),
      ];
      const { view } = mount(entries);
      view.open();

      const svg = view.html.querySelector("svg");
      expect(svg?.getAttribute("aria-label")).toContain("2 games");
      expect(svg?.getAttribute("aria-label")).toContain("300 points");
      restoreTimers();
    });
  });
});
