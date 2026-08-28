import { beforeEach, describe, expect, it } from "vitest";
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

  function mount(entries: HistoryEntry[]) {
    const view = newScoreView({ getEntries: () => entries });
    document.body.append(view.html);
    return view;
  }

  it("shows an empty-state message when there is no history at all", () => {
    const view = mount([]);
    view.open();
    const empty = view.html.querySelector("p");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe("No games scored yet.");
  });

  it("shows the weekly and all-time score totals in a summary line", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ startedAt: mondayStart - 10000, score: 50, status: "won" }), // previous week
    ];
    const view = mount(entries);
    view.open();

    const summaryDiv = Array.from(view.html.querySelectorAll("div")).find((d) =>
      d.textContent?.includes("This week:"),
    );
    expect(summaryDiv).toBeDefined();
    expect(summaryDiv?.textContent).toContain("This week: 300");
    expect(summaryDiv?.textContent).toContain("All-time: 350");
  });

  it("groups entries by week and shows newest week first", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const nextWeekStart = mondayStart + 7 * 24 * 60 * 60 * 1000;

    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100 }),
      entry({ startedAt: mondayStart + 2000, score: 200 }),
      entry({ startedAt: nextWeekStart + 1000, score: 300 }),
    ];
    const view = mount(entries);
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
    const view = mount(entries);
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
    const view = mount(entries);
    view.open();

    const weekItem = view.html.querySelector("ul > li");
    expect(weekItem?.textContent).toContain("2 games won");
  });

  it("shows singular 'game' for 1 game won", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [entry({ startedAt: mondayStart + 1000, score: 100, status: "won" })];
    const view = mount(entries);
    view.open();

    const weekItem = view.html.querySelector("ul > li");
    expect(weekItem?.textContent).toContain("1 game won");
  });

  it("opens the dialog as a modal; close()/backdrop click close it", () => {
    const view = mount([entry()]);
    view.open();
    expect(view.html.open).toBe(true);

    view.close();
    expect(view.html.open).toBe(false);
  });

  it("closes on a backdrop click but not on a click inside the panel", () => {
    const view = mount([entry()]);
    view.open();

    const panel = view.html.firstElementChild!;
    panel.dispatchEvent(new Event("click", { bubbles: true }));
    expect(view.html.open, "a click inside the panel should not close it").toBe(true);

    view.html.dispatchEvent(new Event("click", { bubbles: true }));
    expect(view.html.open).toBe(false);
  });

  it("re-reads getEntries() fresh every time open() is called", () => {
    let entries: HistoryEntry[] = [entry({ score: 100 })];
    const view = newScoreView({ getEntries: () => entries });
    document.body.append(view.html);

    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);

    const nextWeekStart = new Date(2026, 7, 31, 0, 0, 0).getTime();
    entries = [entry({ score: 100 }), entry({ startedAt: nextWeekStart, score: 200 })];
    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("close button clicks close the dialog", () => {
    const view = mount([entry()]);
    view.open();
    expect(view.html.open).toBe(true);

    const closeBtn = view.html.querySelector("button.btn-secondary");
    (closeBtn as HTMLButtonElement).click();
    expect(view.html.open).toBe(false);
  });
});
