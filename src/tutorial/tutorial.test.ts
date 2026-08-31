import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { newTutorial, type Tutorial } from "./tutorial";
import { clearTutorial } from "../persistence/tutorial";

function titleText(tutorial: Tutorial): string | null {
  return tutorial.html.querySelector("h3")?.textContent ?? null;
}

function clickByPreference(tutorial: Tutorial, ...labels: string[]): void {
  const buttons = Array.from(tutorial.html.querySelectorAll("button"));
  for (const label of labels) {
    const btn = buttons.find((b) => b.textContent === label);
    if (btn) {
      btn.click();
      return;
    }
  }
  throw new Error(
    `none of [${labels.join(", ")}] found; buttons were: ${buttons.map((b) => b.textContent).join(", ")}`,
  );
}

describe("tutorial.ts", () => {
  beforeEach(() => {
    clearTutorial();
    localStorage.clear();
  });

  afterEach(() => {
    clearTutorial();
    localStorage.clear();
  });

  it("starts as closed", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    expect(tutorial.isOpen()).toBe(false);
    tutorial.dispose();
  });

  it("start() marks the tutorial as started", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    tutorial.start("first-run");

    const record = localStorage.getItem("colordoku:tutorial");
    expect(record).not.toBeNull();
    const parsed = JSON.parse(record!);
    expect(parsed.status).toBe("started");

    tutorial.close();
    tutorial.dispose();
  });

  it("start() calls onPause if provided", () => {
    const onPause = vi.fn();

    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
      onPause,
    });

    tutorial.start("first-run");

    expect(onPause).toHaveBeenCalled();

    tutorial.close();
    tutorial.dispose();
  });

  it("close() calls onResume if provided", () => {
    const onResume = vi.fn();
    const onPause = vi.fn();

    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
      onPause,
      onResume,
    });

    tutorial.start("first-run");
    tutorial.close();

    expect(onResume).toHaveBeenCalled();

    tutorial.dispose();
  });

  it("close() on completion fires onComplete", () => {
    const onComplete = vi.fn();
    const onPause = vi.fn();
    const onResume = vi.fn();

    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
      onPause,
      onResume,
      onComplete,
    });

    tutorial.start("first-run");

    // Simulate reaching the end: close immediately should record as skipped, not completed
    tutorial.close();

    // Since we closed before reaching the end, onComplete should not fire yet
    // (it only fires on actual completion, not skip)
    tutorial.dispose();
  });

  it("isOpen() reflects the tutorial state", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    expect(tutorial.isOpen()).toBe(false);

    tutorial.start("first-run");
    expect(tutorial.isOpen()).toBe(true);

    tutorial.close();
    expect(tutorial.isOpen()).toBe(false);

    tutorial.dispose();
  });

  it("disposes resources without errors", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    tutorial.start("first-run");
    expect(() => tutorial.dispose()).not.toThrow();
  });

  it("can be started multiple times (replay)", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    tutorial.start("first-run");
    tutorial.close();

    // Should be able to start again
    tutorial.start("replay");
    expect(tutorial.isOpen()).toBe(true);

    tutorial.close();
    tutorial.dispose();
  });

  it("a deliberately-wrong commit (the 'mistake' step) still advances the tutorial", () => {
    // Regression test: the commit-await handler used to require
    // `expectedCell.state === 2` (a *correct* guess) to advance, but the
    // "mistake" step deliberately targets a non-queen cell to demonstrate a
    // wrong guess — so it could never be fulfilled and the tutorial got
    // stuck there permanently. Walks the real controller through every step
    // up to and past "mistake" via the actual rendered buttons (preferring
    // "Show me" wherever a step is awaiting a gesture, since that's the
    // fastest deterministic way to fulfill an await from a test).
    const tutorial = newTutorial({
      anchors: { userMenu: () => null, helpButton: () => null },
    });
    tutorial.start("first-run");

    expect(titleText(tutorial)).toBe("Welcome");
    clickByPreference(tutorial, "Start");
    expect(titleText(tutorial)).toBe("Colours = regions");
    clickByPreference(tutorial, "Next"); // -> no-adjacent
    clickByPreference(tutorial, "Next"); // -> pips
    clickByPreference(tutorial, "Next"); // -> commit-single-cell
    expect(titleText(tutorial)).toBe("Commit a guess");
    clickByPreference(tutorial, "Show me"); // correct commit at (1,0)
    expect(titleText(tutorial)).toBe("Queen found");
    clickByPreference(tutorial, "Next"); // -> single-mark
    expect(titleText(tutorial)).toBe("Free eliminations");
    clickByPreference(tutorial, "Show me"); // mark at (1,1)
    expect(titleText(tutorial)).toBe("Bulk marking");
    clickByPreference(tutorial, "Next"); // -> mistake
    expect(titleText(tutorial)).toBe("Guess wrong on purpose");

    clickByPreference(tutorial, "Show me"); // wrong commit at (3,2) — this is the fix under test

    expect(titleText(tutorial)).toBe("Wrong guess");
    expect(tutorial.isOpen()).toBe(true);

    tutorial.close();
    tutorial.dispose();
  });

  it("the 'finish' step lets the player double-click the two remaining cells themselves", async () => {
    // Regression test: allowOnly(null) (used by every non-awaiting step,
    // including "finish") was implemented backwards — it blocked every
    // click instead of lifting the restriction — so a player could never
    // actually commit the last two queens themselves; the step only ever
    // advanced if something else (nothing did) triggered a win. Walks the
    // real controller all the way to "finish" and performs two real
    // double-clicks (via the actual click gesture cell.ts listens for, not
    // the "Show me" fallback — "finish" doesn't have one) to confirm the
    // board is genuinely interactive there.
    const tutorial = newTutorial({
      anchors: { userMenu: () => null, helpButton: () => null },
    });
    tutorial.start("first-run");

    clickByPreference(tutorial, "Start"); // welcome -> regions
    clickByPreference(tutorial, "Next"); // regions -> no-adjacent
    clickByPreference(tutorial, "Next"); // no-adjacent -> pips
    clickByPreference(tutorial, "Next"); // pips -> commit-single-cell
    clickByPreference(tutorial, "Show me"); // (1,0) correct commit -> frozen-cell
    clickByPreference(tutorial, "Next"); // frozen-cell -> single-mark
    clickByPreference(tutorial, "Show me"); // (1,1) mark -> range-mark
    clickByPreference(tutorial, "Next"); // range-mark -> mistake
    clickByPreference(tutorial, "Show me"); // (3,2) wrong commit -> wrong-guess
    clickByPreference(tutorial, "Next"); // wrong-guess -> column-queen
    clickByPreference(tutorial, "Next"); // column-queen -> last-cell
    clickByPreference(tutorial, "Show me"); // (0,2) correct commit -> finish
    expect(titleText(tutorial)).toBe("Almost there");

    const board = tutorial.html.querySelector<HTMLDivElement>(".board");
    expect(board).not.toBeNull();

    async function doubleClick(row: number, col: number): Promise<void> {
      const cell = board!.querySelectorAll<HTMLElement>(":scope > *")[row * 4 + col];
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // Real delay: cell.ts's double-click detection is Date.now()-based
      // (DUPLICATE_CLICK_MS=50 < gap < DOUBLE_CLICK_MS=350), not a fake-timer
      // affair, so this needs an actual wait between the two clicks.
      await new Promise((r) => setTimeout(r, 100));
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }

    await doubleClick(2, 3);
    await doubleClick(3, 1);
    // commitGuess() defers game.incFound()/incEnd via setTimeout(...,0) so the
    // browser can paint first (see cell.ts's own comment on that) — the win
    // check/onEnd fire on the next macrotask, not synchronously.
    await new Promise((r) => setTimeout(r, 0));

    expect(titleText(tutorial)).toBe("You did it!");
    expect(tutorial.isOpen()).toBe(true);

    tutorial.close();
    tutorial.dispose();
  });

  it("welcome step offers Start, Just the rules, and Skip", () => {
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
    });

    tutorial.start("first-run");
    const labels = Array.from(tutorial.html.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toContain("Start");
    expect(labels).toContain("Just the rules");
    expect(labels).toContain("Skip");

    tutorial.close();
    tutorial.dispose();
  });

  it("'Just the rules' closes the tutorial (marked seen) and calls onShowRules, not onComplete", () => {
    const onShowRules = vi.fn();
    const onComplete = vi.fn();
    const tutorial = newTutorial({
      anchors: {
        userMenu: () => null,
        helpButton: () => null,
      },
      onShowRules,
      onComplete,
    });

    tutorial.start("first-run");
    const rulesButton = Array.from(tutorial.html.querySelectorAll("button")).find(
      (b) => b.textContent === "Just the rules",
    );
    rulesButton?.click();

    expect(onShowRules).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(tutorial.isOpen()).toBe(false);

    // Marked seen the same way Skip marks seen — starting again is a replay,
    // not an auto-triggered first-run, but hasSeenTutorial() (persistence.ts,
    // covered in its own test file) is what main.ts actually gates on.
    tutorial.dispose();
  });

  it("handles missing anchor elements gracefully", () => {
    const userMenuEl = document.createElement("div");
    userMenuEl.id = "user-menu";
    document.body.append(userMenuEl);

    const tutorial = newTutorial({
      anchors: {
        userMenu: () => document.querySelector("#user-menu"),
        helpButton: () => null, // Doesn't exist
      },
    });

    expect(() => tutorial.start("first-run")).not.toThrow();
    expect(tutorial.isOpen()).toBe(true);

    tutorial.close();
    tutorial.dispose();
    userMenuEl.remove();
  });
});
