import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newGame } from "../game/game";
import { DOUBLE_CLICK_MS, DUPLICATE_CLICK_MS, newCell } from "./cell";
import classes from "./cell.module.css";

describe("restore (used to re-hydrate a saved game after reload)", () => {
  it("sets state and frozen directly, bypassing the frozen guard", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.restore(1, true);
    expect(cell.state).toBe(1);
    expect(cell.frozen).toBe(true);
  });

  it("re-renders the view to match the restored state", () => {
    const cell = newCell(newGame(4, 2), 0, true);
    cell.restore(2, true);
    expect(cell.html.innerHTML).toBe("♛");
  });

  it("adds the found styling for a restored correct-queen cell", () => {
    const cell = newCell(newGame(4, 2), 0, true);
    cell.restore(2, true);
    expect(cell.html.className).toContain(classes.found);
  });

  it("adds the error styling for a restored incorrect-guess cell", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.restore(1, true);
    expect(cell.html.className).toContain(classes.error);
  });

  it("adds no found/error styling for a merely-eliminated, still-unfrozen cell", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.restore(1, false);
    expect(cell.html.className).not.toContain(classes.found);
    expect(cell.html.className).not.toContain(classes.error);
  });

  it("does not call game.incFound/incGuess — restoring is not a real guess", () => {
    const game = newGame(4, 2);
    const before = { guessesLeft: game.guessesLeft, queensFound: game.queensFound };
    const cell = newCell(game, 0, true);
    cell.restore(2, true);
    expect(game.guessesLeft).toBe(before.guessesLeft);
    expect(game.queensFound).toBe(before.queensFound);
  });
});

describe("mark (used by board.ts's shift+click / drag multi-cell gestures)", () => {
  it("sets state without touching found/error styling", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.mark(1);
    expect(cell.state).toBe(1);
    expect(cell.html.className).not.toContain(classes.found);
    expect(cell.html.className).not.toContain(classes.error);
  });

  it("toggles the view the same way a real click would", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.mark(1);
    expect(cell.html.innerHTML).toBe("X");
    cell.mark(0);
    expect(cell.html.innerHTML).toBe("");
  });

  it("never freezes the cell or calls game.incFound/incGuess — it is not a guess", () => {
    const game = newGame(4, 2);
    const incFound = vi.spyOn(game, "incFound");
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, true);
    cell.mark(1);
    expect(cell.frozen).toBe(false);
    expect(incFound).not.toHaveBeenCalled();
    expect(incGuess).not.toHaveBeenCalled();
  });

  it("respects the frozen guard, like a real click does", () => {
    const cell = newCell(newGame(4, 2), 0, false);
    cell.restore(2, true); // frozen, e.g. from a real guess or a resumed save
    cell.mark(1);
    expect(cell.state).toBe(2); // unchanged
  });
});

/** Fires a click event on the cell's html element at the given system time. */
function clickAt(html: HTMLElement, atMs: number): void {
  vi.setSystemTime(atMs);
  html.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("cell click handling (debounced double-click)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("single clicks far apart toggle mark on/off, no game calls", () => {
    const game = newGame(4, 3);
    const incFound = vi.spyOn(game, "incFound");
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, false);

    clickAt(cell.html, 0);
    expect(cell.state).toBe(1);

    clickAt(cell.html, 1000); // well outside DOUBLE_CLICK_MS
    expect(cell.state).toBe(0);

    expect(cell.frozen).toBe(false);
    expect(incFound).not.toHaveBeenCalled();
    expect(incGuess).not.toHaveBeenCalled();
  });

  it("two clicks inside the confirm window on a queen cell commits found", () => {
    const game = newGame(4, 3);
    const incFound = vi.spyOn(game, "incFound");
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, true);

    clickAt(cell.html, 0);
    clickAt(cell.html, DUPLICATE_CLICK_MS + 20); // inside confirm window, outside duplicate guard

    expect(cell.state).toBe(2);
    expect(cell.frozen).toBe(true);
    expect(cell.html.className).toContain(classes.found);
    vi.advanceTimersByTime(0);
    expect(incFound).toHaveBeenCalledTimes(1);
    expect(incGuess).not.toHaveBeenCalled();
  });

  it("two clicks inside the confirm window on a non-queen cell commits error", () => {
    const game = newGame(4, 3);
    const incFound = vi.spyOn(game, "incFound");
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, false);

    clickAt(cell.html, 0);
    clickAt(cell.html, DUPLICATE_CLICK_MS + 20);

    expect(cell.state).toBe(1);
    expect(cell.frozen).toBe(true);
    expect(cell.html.className).toContain(classes.error);
    vi.advanceTimersByTime(0);
    expect(incGuess).toHaveBeenCalledTimes(1);
    expect(incFound).not.toHaveBeenCalled();
  });

  it("two clicks inside the duplicate guard are treated as one click", () => {
    const game = newGame(4, 3);
    const incFound = vi.spyOn(game, "incFound");
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, true);

    clickAt(cell.html, 0);
    clickAt(cell.html, DUPLICATE_CLICK_MS - 10); // inside duplicate guard

    expect(cell.state).toBe(1); // only the first click's toggle took effect
    expect(cell.frozen).toBe(false);
    expect(incFound).not.toHaveBeenCalled();
    expect(incGuess).not.toHaveBeenCalled();
  });

  it("a frozen cell ignores further clicks", () => {
    const game = newGame(4, 3);
    const incFound = vi.spyOn(game, "incFound");
    const cell = newCell(game, 0, true);

    clickAt(cell.html, 0);
    clickAt(cell.html, DUPLICATE_CLICK_MS + 20); // commits found, freezes
    expect(cell.frozen).toBe(true);

    const classNameBefore = cell.html.className;
    const stateBefore = cell.state;

    clickAt(cell.html, DUPLICATE_CLICK_MS + 20 + DOUBLE_CLICK_MS + 20);

    expect(cell.state).toBe(stateBefore);
    expect(cell.html.className).toBe(classNameBefore);
    vi.advanceTimersByTime(0);
    expect(incFound).toHaveBeenCalledTimes(1);
  });

  it("a third rapid click after a commit is a no-op, not chained into a second commit", () => {
    const game = newGame(4, 3);
    const incGuess = vi.spyOn(game, "incGuess");
    const cell = newCell(game, 0, false);

    clickAt(cell.html, 0);
    clickAt(cell.html, DUPLICATE_CLICK_MS + 20); // commits error, freezes
    clickAt(cell.html, DUPLICATE_CLICK_MS + 20 + DUPLICATE_CLICK_MS + 20); // rapid 3rd click

    expect(cell.frozen).toBe(true);
    vi.advanceTimersByTime(0);
    expect(incGuess).toHaveBeenCalledTimes(1); // not called again
  });
});

describe("toggle/commit (public wrappers used by X/Q keyboard handling)", () => {
  describe("toggle()", () => {
    it("flips state 0 ↔ 1 without touching found/error styling", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      expect(cell.state).toBe(0);

      cell.toggle();
      expect(cell.state).toBe(1);
      expect(cell.html.className).not.toContain(classes.found);
      expect(cell.html.className).not.toContain(classes.error);

      cell.toggle();
      expect(cell.state).toBe(0);
      expect(cell.html.className).not.toContain(classes.found);
      expect(cell.html.className).not.toContain(classes.error);
    });

    it("respects the frozen guard and is a no-op if frozen", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      cell.restore(2, true); // frozen
      const stateBefore = cell.state;

      cell.toggle();
      expect(cell.state).toBe(stateBefore);
    });
  });

  describe("commit()", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("commits found on a queen cell with the setTimeout(fn, 0) deferral intact", () => {
      const game = newGame(4, 3);
      const incFound = vi.spyOn(game, "incFound");
      const cell = newCell(game, 0, true);

      cell.commit();

      expect(cell.state).toBe(2);
      expect(cell.frozen).toBe(true);
      expect(cell.html.className).toContain(classes.found);
      expect(incFound).not.toHaveBeenCalled(); // not called yet due to setTimeout

      vi.advanceTimersByTime(0);
      expect(incFound).toHaveBeenCalledTimes(1);
    });

    it("commits error on a non-queen cell with the setTimeout(fn, 0) deferral intact", () => {
      const game = newGame(4, 3);
      const incGuess = vi.spyOn(game, "incGuess");
      const cell = newCell(game, 0, false);

      cell.commit();

      expect(cell.state).toBe(1);
      expect(cell.frozen).toBe(true);
      expect(cell.html.className).toContain(classes.error);
      expect(incGuess).not.toHaveBeenCalled(); // not called yet due to setTimeout

      vi.advanceTimersByTime(0);
      expect(incGuess).toHaveBeenCalledTimes(1);
    });

    it("respects the frozen guard and is a no-op if already frozen", () => {
      const game = newGame(4, 3);
      const incFound = vi.spyOn(game, "incFound");
      const cell = newCell(game, 0, true);

      cell.restore(2, true); // already frozen
      const stateBefore = cell.state;

      cell.commit();

      expect(cell.state).toBe(stateBefore);
      expect(cell.frozen).toBe(true);
      vi.advanceTimersByTime(0);
      expect(incFound).not.toHaveBeenCalled();
    });
  });
});

describe("undo hooks (onMark and onFreeze)", () => {
  describe("onMark", () => {
    it("called by toggle() with previous state", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onMark = vi.fn();
      cell.onMark = onMark;

      cell.toggle(); // 0 -> 1
      expect(onMark).toHaveBeenCalledWith(0);

      cell.toggle(); // 1 -> 0
      expect(onMark).toHaveBeenCalledWith(1);

      expect(onMark).toHaveBeenCalledTimes(2);
    });

    it("called by mark() when state changes", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onMark = vi.fn();
      cell.onMark = onMark;

      cell.mark(1);
      expect(onMark).toHaveBeenCalledWith(0);

      cell.mark(0);
      expect(onMark).toHaveBeenCalledWith(1);
    });

    it("not called when mark() is passed the cell's current state", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onMark = vi.fn();
      cell.onMark = onMark;

      cell.mark(0); // already 0

      expect(onMark).not.toHaveBeenCalled();
    });

    it("not called by commit() — even for found or error", () => {
      const game = newGame(4, 2);
      const cell1 = newCell(game, 0, true);
      const cell2 = newCell(game, 0, false);
      const onMark1 = vi.fn();
      const onMark2 = vi.fn();
      cell1.onMark = onMark1;
      cell2.onMark = onMark2;

      cell1.commit(); // found
      cell2.commit(); // error

      expect(onMark1).not.toHaveBeenCalled();
      expect(onMark2).not.toHaveBeenCalled();
    });

    it("not called by restore()", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onMark = vi.fn();
      cell.onMark = onMark;

      cell.restore(1, false);

      expect(onMark).not.toHaveBeenCalled();
    });
  });

  describe("onFreeze", () => {
    it("called by commit() for both queen and non-queen", () => {
      const game = newGame(4, 2);
      const cell1 = newCell(game, 0, true);
      const cell2 = newCell(game, 0, false);
      const onFreeze1 = vi.fn();
      const onFreeze2 = vi.fn();
      cell1.onFreeze = onFreeze1;
      cell2.onFreeze = onFreeze2;

      cell1.commit();
      cell2.commit();

      expect(onFreeze1).toHaveBeenCalledTimes(1);
      expect(onFreeze2).toHaveBeenCalledTimes(1);
    });

    it("called by restore(state, true) when restoring frozen", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onFreeze = vi.fn();
      cell.onFreeze = onFreeze;

      cell.restore(1, true);

      expect(onFreeze).toHaveBeenCalledTimes(1);
    });

    it("not called by restore(state, false) when restoring unfrozen", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onFreeze = vi.fn();
      cell.onFreeze = onFreeze;

      cell.restore(1, false);

      expect(onFreeze).not.toHaveBeenCalled();
    });

    it("not called by mark()", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onFreeze = vi.fn();
      cell.onFreeze = onFreeze;

      cell.mark(1);

      expect(onFreeze).not.toHaveBeenCalled();
    });

    it("not called by toggle()", () => {
      const cell = newCell(newGame(4, 2), 0, false);
      const onFreeze = vi.fn();
      cell.onFreeze = onFreeze;

      cell.toggle();

      expect(onFreeze).not.toHaveBeenCalled();
    });
  });

  describe("onQueenFound", () => {
    it("called by commit() only on a queen cell", () => {
      const game = newGame(4, 2);
      const cell1 = newCell(game, 0, true);
      const cell2 = newCell(game, 0, false);
      const onQueenFound1 = vi.fn();
      const onQueenFound2 = vi.fn();
      cell1.onQueenFound = onQueenFound1;
      cell2.onQueenFound = onQueenFound2;

      cell1.commit();
      cell2.commit();

      expect(onQueenFound1).toHaveBeenCalledTimes(1);
      expect(onQueenFound2).not.toHaveBeenCalled();
    });

    it("fires after onFreeze in the same commit", () => {
      const game = newGame(4, 2);
      const cell = newCell(game, 0, true);
      const callOrder: string[] = [];
      cell.onFreeze = () => callOrder.push("onFreeze");
      cell.onQueenFound = () => callOrder.push("onQueenFound");

      cell.commit();

      expect(callOrder).toEqual(["onFreeze", "onQueenFound"]);
    });

    it("not called by restore() even for a restored queen cell", () => {
      const cell = newCell(newGame(4, 2), 0, true);
      const onQueenFound = vi.fn();
      cell.onQueenFound = onQueenFound;

      cell.restore(2, true);

      expect(onQueenFound).not.toHaveBeenCalled();
    });

    it("not called by mark()", () => {
      const cell = newCell(newGame(4, 2), 0, true);
      const onQueenFound = vi.fn();
      cell.onQueenFound = onQueenFound;

      cell.mark(1);

      expect(onQueenFound).not.toHaveBeenCalled();
    });

    it("not called by toggle()", () => {
      const cell = newCell(newGame(4, 2), 0, true);
      const onQueenFound = vi.fn();
      cell.onQueenFound = onQueenFound;

      cell.toggle();

      expect(onQueenFound).not.toHaveBeenCalled();
    });
  });
});
