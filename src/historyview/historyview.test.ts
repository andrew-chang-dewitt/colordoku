import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../persistence/history";
import {
  filterEntries,
  newHistoryView,
  sizesIn,
  sortEntries,
} from "./historyview";
import classes from "./historyview.module.css";

let nextId = 0;
function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  nextId += 1;
  return {
    id: `entry-${nextId}`,
    size: 4,
    seed: 111,
    attempt: 1,
    status: "playing",
    elapsedMs: 1000,
    score: null,
    difficulty: "medium",
    startedAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("filterEntries", () => {
  it("keeps everything when both filters are 'all'", () => {
    const entries = [entry({ status: "won" }), entry({ status: "lost", size: 8 })];
    expect(filterEntries(entries, { status: "all", size: "all" })).toHaveLength(2);
  });

  it("filters by status", () => {
    const entries = [entry({ status: "won" }), entry({ status: "lost" }), entry({ status: "won" })];
    const result = filterEntries(entries, { status: "won", size: "all" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.status === "won")).toBe(true);
  });

  it("filters by size", () => {
    const entries = [entry({ size: 4 }), entry({ size: 8 }), entry({ size: 4 })];
    const result = filterEntries(entries, { status: "all", size: 8 });
    expect(result).toHaveLength(1);
    expect(result[0].size).toBe(8);
  });

  it("combines both filters", () => {
    const entries = [
      entry({ status: "won", size: 4 }),
      entry({ status: "won", size: 8 }),
      entry({ status: "lost", size: 4 }),
    ];
    const result = filterEntries(entries, { status: "won", size: 4 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: "won", size: 4 });
  });
});

describe("sortEntries", () => {
  it("newest first, by startedAt descending", () => {
    const entries = [entry({ startedAt: 100 }), entry({ startedAt: 300 }), entry({ startedAt: 200 })];
    expect(sortEntries(entries, "newest").map((e) => e.startedAt)).toEqual([300, 200, 100]);
  });

  it("oldest first, by startedAt ascending", () => {
    const entries = [entry({ startedAt: 100 }), entry({ startedAt: 300 }), entry({ startedAt: 200 })];
    expect(sortEntries(entries, "oldest").map((e) => e.startedAt)).toEqual([100, 200, 300]);
  });

  it("longest played first, by elapsedMs descending", () => {
    const entries = [entry({ elapsedMs: 500 }), entry({ elapsedMs: 5000 }), entry({ elapsedMs: 1000 })];
    expect(sortEntries(entries, "longest").map((e) => e.elapsedMs)).toEqual([5000, 1000, 500]);
  });

  it("shortest played first, by elapsedMs ascending", () => {
    const entries = [entry({ elapsedMs: 500 }), entry({ elapsedMs: 5000 }), entry({ elapsedMs: 1000 })];
    expect(sortEntries(entries, "shortest").map((e) => e.elapsedMs)).toEqual([500, 1000, 5000]);
  });

  it("largest board first, by size descending", () => {
    const entries = [entry({ size: 4 }), entry({ size: 16 }), entry({ size: 8 })];
    expect(sortEntries(entries, "largest").map((e) => e.size)).toEqual([16, 8, 4]);
  });

  it("smallest board first, by size ascending", () => {
    const entries = [entry({ size: 4 }), entry({ size: 16 }), entry({ size: 8 })];
    expect(sortEntries(entries, "smallest").map((e) => e.size)).toEqual([4, 8, 16]);
  });

  it("highest score first, by score descending", () => {
    const entries = [entry({ score: 100 }), entry({ score: 900 }), entry({ score: 500 })];
    expect(sortEntries(entries, "score").map((e) => e.score)).toEqual([900, 500, 100]);
  });

  it("sorts unscored (null) entries to the bottom under 'highest score', not treated as zero", () => {
    const entries = [entry({ score: null }), entry({ score: -50 }), entry({ score: 10 })];
    // -50 is a real (if bad) score and must still rank above "no score at all".
    expect(sortEntries(entries, "score").map((e) => e.score)).toEqual([10, -50, null]);
  });

  it("does not mutate the input array", () => {
    const entries = [entry({ startedAt: 100 }), entry({ startedAt: 300 })];
    const original = [...entries];
    sortEntries(entries, "newest");
    expect(entries).toEqual(original);
  });
});

describe("sizesIn", () => {
  it("returns distinct sizes, ascending", () => {
    const entries = [entry({ size: 8 }), entry({ size: 4 }), entry({ size: 8 }), entry({ size: 16 })];
    expect(sizesIn(entries)).toEqual([4, 8, 16]);
  });

  it("returns an empty array for no entries", () => {
    expect(sizesIn([])).toEqual([]);
  });
});

describe("newHistoryView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // jsdom/happy-dom doesn't implement scrollIntoView; stub it so
    // open(focusEntryId) doesn't throw when it calls this.
    Element.prototype.scrollIntoView = vi.fn();
  });

  function mount(entries: HistoryEntry[], onPlayAgain = vi.fn()) {
    const view = newHistoryView({ onPlayAgain, getEntries: () => entries });
    document.body.append(view.html);
    return { view, onPlayAgain };
  }

  it("shows an empty-state message when there is no history at all", () => {
    const { view } = mount([]);
    view.open();
    const empty = view.html.querySelector("p");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe("No games played yet.");
  });

  it("renders one row per entry, newest first by default", () => {
    const { view } = mount([entry({ startedAt: 100, size: 4 }), entry({ startedAt: 300, size: 8 })]);
    view.open();
    const rows = view.html.querySelectorAll("ul > li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("8×8");
    expect(rows[1].textContent).toContain("4×4");
  });

  it("shows size, status, attempt number, and elapsed time on each row", () => {
    const { view } = mount([
      entry({ size: 6, status: "won", attempt: 3, elapsedMs: 65_000 }),
    ]);
    view.open();
    const row = view.html.querySelector("ul > li")!;
    expect(row.textContent).toContain("6×6");
    expect(row.textContent).toContain("Won");
    expect(row.textContent).toContain("Attempt 3");
    expect(row.textContent).toContain("1:05"); // formatElapsed(65_000)
  });

  it("shows a scored entry's score", () => {
    const { view } = mount([entry({ score: 1234 })]);
    view.open();
    expect(view.html.querySelector("ul > li")!.textContent).toContain("Score: 1234");
  });

  it("shows a placeholder, not a bogus zero, for an unscored entry", () => {
    const { view } = mount([entry({ score: null })]);
    view.open();
    expect(view.html.querySelector("ul > li")!.textContent).toContain("Score: —");
  });

  it("sorting by highest score reorders the rows", () => {
    const { view } = mount([entry({ size: 4, score: 50 }), entry({ size: 8, score: 900 })]);
    view.open();

    const sortSelect = view.html.querySelectorAll("select")[2] as HTMLSelectElement;
    sortSelect.value = "score";
    sortSelect.dispatchEvent(new Event("change"));

    const rows = view.html.querySelectorAll("ul > li");
    expect(rows[0].textContent).toContain("8×8");
    expect(rows[1].textContent).toContain("4×4");
  });

  it("filtering by status narrows the rendered rows", () => {
    const { view } = mount([entry({ status: "won" }), entry({ status: "lost" })]);
    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(2);

    const statusSelect = view.html.querySelectorAll("select")[0] as HTMLSelectElement;
    statusSelect.value = "won";
    statusSelect.dispatchEvent(new Event("change"));

    const rows = view.html.querySelectorAll("ul > li");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Won");
  });

  it("filtering by size narrows the rendered rows and offers only sizes actually present", () => {
    const { view } = mount([entry({ size: 4 }), entry({ size: 8 }), entry({ size: 4 })]);
    view.open();

    const sizeSelect = view.html.querySelectorAll("select")[1] as HTMLSelectElement;
    const options = Array.from(sizeSelect.options).map((o) => o.value);
    expect(options).toEqual(["all", "4", "8"]);

    sizeSelect.value = "4";
    sizeSelect.dispatchEvent(new Event("change"));
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("shows the 'no games match' message (not the 'no games yet' one) when filters exclude everything but history isn't empty", () => {
    const { view } = mount([entry({ status: "won" })]);
    view.open();

    const statusSelect = view.html.querySelectorAll("select")[0] as HTMLSelectElement;
    statusSelect.value = "lost";
    statusSelect.dispatchEvent(new Event("change"));

    const empty = view.html.querySelector("p")!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("No games match these filters.");
  });

  it("sorting by longest played reorders the rows", () => {
    const { view } = mount([
      entry({ size: 4, elapsedMs: 500 }),
      entry({ size: 8, elapsedMs: 9000 }),
    ]);
    view.open();

    const sortSelect = view.html.querySelectorAll("select")[2] as HTMLSelectElement;
    sortSelect.value = "longest";
    sortSelect.dispatchEvent(new Event("change"));

    const rows = view.html.querySelectorAll("ul > li");
    expect(rows[0].textContent).toContain("8×8");
    expect(rows[1].textContent).toContain("4×4");
  });

  it("'Play again' calls onPlayAgain with that entry's size, seed, and difficulty", () => {
    const { view, onPlayAgain } = mount([entry({ size: 8, seed: 424242, difficulty: "hard" })]);
    view.open();

    const button = Array.from(view.html.querySelectorAll("button")).find(
      (b) => b.textContent === "Play again",
    )!;
    button.click();

    expect(onPlayAgain).toHaveBeenCalledWith(8, 424242, "hard");
  });

  it("shows the entry's difficulty", () => {
    const { view } = mount([entry({ difficulty: "hard" })]);
    view.open();
    expect(view.html.querySelector("ul > li")!.textContent).toContain("Hard");
  });

  it("each row also gets a Share button", () => {
    const { view } = mount([entry()]);
    view.open();
    const shareButton = Array.from(view.html.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Share"),
    );
    expect(shareButton).not.toBeUndefined();
  });

  it("re-reads getEntries() fresh every time open() is called", () => {
    let entries: HistoryEntry[] = [entry({ size: 4 })];
    const view = newHistoryView({ onPlayAgain: vi.fn(), getEntries: () => entries });
    document.body.append(view.html);

    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);

    entries = [entry({ size: 4 }), entry({ size: 8 })];
    view.open();
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("open() opens the dialog as a modal; close()/backdrop click close it", () => {
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

  it("shows the weekly and all-time score totals in a summary line", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [
      entry({ startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ startedAt: mondayStart - 10000, score: 50, status: "won" }), // previous week
    ];
    const view = newHistoryView({ onPlayAgain: vi.fn(), getEntries: () => entries });
    document.body.append(view.html);
    view.open();

    const summaryDiv = Array.from(view.html.querySelectorAll("div")).find((d) =>
      d.textContent?.includes("This week:"),
    );
    expect(summaryDiv).toBeDefined();
    expect(summaryDiv?.textContent).toContain("This week: 300");
    expect(summaryDiv?.textContent).toContain("All-time: 350");
  });

  it("shows the running total for each entry in the same week", () => {
    const mondayStart = new Date(2026, 7, 24, 0, 0, 0).getTime();
    const entries = [
      entry({ id: "1", startedAt: mondayStart + 1000, score: 100, status: "won" }),
      entry({ id: "2", startedAt: mondayStart + 2000, score: 200, status: "won" }),
      entry({ id: "3", startedAt: mondayStart + 3000, score: 150, status: "won" }),
    ];
    const view = newHistoryView({ onPlayAgain: vi.fn(), getEntries: () => entries });
    document.body.append(view.html);
    view.open();

    const rows = view.html.querySelectorAll("ul > li");
    expect(rows[0].textContent).toContain("Week total: 450"); // newest entry (entry 3)
    expect(rows[1].textContent).toContain("Week total: 300"); // entry 2
    expect(rows[2].textContent).toContain("Week total: 100"); // entry 1 (oldest)
  });

  it("gives each rendered row a data-entry-id matching its HistoryEntry", () => {
    const target = entry({ id: "target-entry" });
    const { view } = mount([target, entry()]);
    view.open();

    const row = view.html.querySelector('li[data-entry-id="target-entry"]');
    expect(row).not.toBeNull();
  });

  it("open(entryId) resets active status/size filters to 'all' so the target entry can't be hidden", () => {
    const target = entry({ id: "target-entry", status: "won", size: 8 });
    const other = entry({ status: "lost", size: 4 });
    const { view } = mount([target, other]);
    view.open();

    // Apply filters that would hide the target entry.
    const statusSelect = view.html.querySelectorAll("select")[0] as HTMLSelectElement;
    statusSelect.value = "lost";
    statusSelect.dispatchEvent(new Event("change"));
    const sizeSelect = view.html.querySelectorAll("select")[1] as HTMLSelectElement;
    sizeSelect.value = "4";
    sizeSelect.dispatchEvent(new Event("change"));
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);

    view.open("target-entry");

    expect(statusSelect.value).toBe("all");
    expect(sizeSelect.value).toBe("all");
    const rows = view.html.querySelectorAll("ul > li");
    expect(rows).toHaveLength(2);
    expect(view.html.querySelector('li[data-entry-id="target-entry"]')).not.toBeNull();
  });

  it("open(entryId) scrolls the matching row into view and applies a temporary highlight", () => {
    vi.useFakeTimers();
    try {
      const target = entry({ id: "target-entry" });
      const { view } = mount([target, entry()]);

      view.open("target-entry");

      const row = view.html.querySelector('li[data-entry-id="target-entry"]') as HTMLLIElement;
      expect(row.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(row.classList.contains(classes.entryHighlight)).toBe(true);

      vi.runAllTimers();
      expect(row.classList.contains(classes.entryHighlight)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("open() with no argument does not reset active filters", () => {
    const { view } = mount([entry({ status: "won" }), entry({ status: "lost" })]);
    view.open();

    const statusSelect = view.html.querySelectorAll("select")[0] as HTMLSelectElement;
    statusSelect.value = "won";
    statusSelect.dispatchEvent(new Event("change"));
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);

    view.open();
    expect(statusSelect.value).toBe("won");
    expect(view.html.querySelectorAll("ul > li")).toHaveLength(1);
  });
});
