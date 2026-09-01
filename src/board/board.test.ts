import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import { newGame } from "../game/game";
import { attachRangeGestures, attachKeyboardNavigation, cellsBetween, coordsToEliminate, attachAutoEliminate, directionFor, maxGuessesFor } from "./board";
import { newUndoStack } from "../undo/undo";

// attachRangeGestures's mouse-drag handling attaches its mousemove/mouseup
// listeners to `window` (see its doc comment for why), which — unlike DOM
// nodes removed via document.body.innerHTML — isn't cleaned up just by
// clearing the body between tests. Left unaddressed, every test's board
// would leak a listener closing over that test's now-discarded cells into
// every later test's `window` mouse events. buildGrid collects each board's
// disposer here; the top-level afterEach below calls all of them.
let disposers: Array<() => void> = [];

/**
 * A minimal real board for exercising attachRangeGestures directly, without
 * going through newBoard()'s async wasm/worker generation (which the rest of
 * this file's comments already note isn't worth pulling into unit tests).
 * Cells are real newCell() instances — not mocks — so the frozen guard, view
 * rendering, etc. all behave exactly as they do in the app.
 */
function buildGrid(size: number, queens: Array<[number, number]> = [], withUndo = false): { cells: Cell[][]; board: HTMLDivElement; undo?: ReturnType<typeof newUndoStack> } {
  const game = newGame(size, size); // generous guess budget; guess-commit isn't under test here
  const isQueen = (r: number, c: number) => queens.some(([qr, qc]) => qr === r && qc === c);
  const cells: Cell[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => newCell(game, 0, isQueen(r, c))),
  );
  const board = document.createElement("div");
  cells.forEach((row) => row.forEach((cell) => board.append(cell.html)));
  document.body.append(board);
  const undo = withUndo ? newUndoStack(cells) : undefined;
  disposers.push(attachRangeGestures(board, cells, undo));
  return { cells, board, undo };
}

afterEach(() => {
  disposers.forEach((dispose) => dispose());
  disposers = [];
  document.body.innerHTML = "";
});

function shiftClick(cell: Cell): void {
  cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
}

function plainClick(cell: Cell): void {
  cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const states = (cells: Cell[]): number[] => cells.map((c) => c.state);

describe("maxGuessesFor", () => {
  it("medium: matches the plan's explicit anchors (12x12 -> 3, 6x6-or-smaller -> 1)", () => {
    expect(maxGuessesFor(12, "medium")).toBe(3);
    expect(maxGuessesFor(6, "medium")).toBe(1);
    expect(maxGuessesFor(4, "medium")).toBe(1);
  });

  it("medium: grows sub-linearly with size, unlike the old ceil(size/2)", () => {
    expect(maxGuessesFor(16, "medium")).toBeLessThan(8);
  });

  it("easy: never exceeds 2 guesses at 6x6", () => {
    expect(maxGuessesFor(6, "easy")).toBeLessThanOrEqual(2);
  });

  it("easy allows more guesses than medium at the same size", () => {
    for (const size of [8, 12, 16]) {
      expect(maxGuessesFor(size, "easy")).toBeGreaterThanOrEqual(maxGuessesFor(size, "medium"));
    }
  });

  it("hard allows fewer or equal guesses than medium at the same size", () => {
    for (const size of [8, 12, 16]) {
      expect(maxGuessesFor(size, "hard")).toBeLessThanOrEqual(maxGuessesFor(size, "medium"));
    }
  });

  it("always leaves at least one guess, at every tier", () => {
    expect(maxGuessesFor(4, "easy")).toBeGreaterThanOrEqual(1);
    expect(maxGuessesFor(4, "medium")).toBeGreaterThanOrEqual(1);
    expect(maxGuessesFor(4, "hard")).toBeGreaterThanOrEqual(1);
  });
});

describe("cellsBetween (shift+click range-toggle geometry)", () => {
  it("returns the inclusive run across a row, left to right", () => {
    expect(cellsBetween({ row: 2, col: 0 }, { row: 2, col: 3 })).toEqual([
      { row: 2, col: 0 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
    ]);
  });

  it("returns the same run regardless of click order (right to left)", () => {
    expect(cellsBetween({ row: 2, col: 3 }, { row: 2, col: 0 })).toEqual([
      { row: 2, col: 0 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
      { row: 2, col: 3 },
    ]);
  });

  it("returns the inclusive run down a column, either order", () => {
    expect(cellsBetween({ row: 0, col: 1 }, { row: 2, col: 1 })).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
    expect(cellsBetween({ row: 2, col: 1 }, { row: 0, col: 1 })).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 1 },
      { row: 2, col: 1 },
    ]);
  });

  it("treats the same cell clicked twice as a degenerate range of one", () => {
    expect(cellsBetween({ row: 1, col: 1 }, { row: 1, col: 1 })).toEqual([{ row: 1, col: 1 }]);
  });

  it("returns null for a diagonal (or otherwise unaligned) pair", () => {
    expect(cellsBetween({ row: 0, col: 0 }, { row: 1, col: 1 })).toBeNull();
    expect(cellsBetween({ row: 0, col: 0 }, { row: 3, col: 2 })).toBeNull();
  });
});

describe("attachRangeGestures: shift+click range toggle", () => {
  it("toggles every cell in a row range, inclusive, from unmarked to eliminated", () => {
    const { cells } = buildGrid(4);
    shiftClick(cells[0][0]);
    shiftClick(cells[0][3]);
    expect(states(cells[0])).toEqual([1, 1, 1, 1]);
  });

  it("toggles back to unmarked when the anchor was already eliminated", () => {
    const { cells } = buildGrid(4);
    plainClick(cells[1][1]); // 0 -> 1, sets up the anchor's starting value
    shiftClick(cells[1][1]);
    shiftClick(cells[1][3]);
    expect(states(cells[1].slice(1, 4))).toEqual([0, 0, 0]);
  });

  it("does not also run the cell's own click handler (no double-toggle)", () => {
    const { cells } = buildGrid(4);
    shiftClick(cells[0][0]); // sets the anchor only — closes no range yet
    // If propagation to cell.ts's own handler weren't stopped, this single
    // shift+click would itself register as a normal first click and toggle
    // the cell — it must not.
    expect(cells[0][0].state).toBe(0);
  });

  it("skips frozen cells within the range, leaving them untouched", () => {
    const { cells } = buildGrid(4);
    cells[0][1].restore(2, true); // frozen mid-range, e.g. an already-found queen
    shiftClick(cells[0][0]);
    shiftClick(cells[0][3]);
    expect(states(cells[0])).toEqual([1, 2, 1, 1]);
    expect(cells[0][1].frozen).toBe(true);
  });

  it("leaves the anchor untouched after a misaligned second click, so retrying works", () => {
    const { cells } = buildGrid(4);
    shiftClick(cells[0][0]);
    shiftClick(cells[1][1]); // diagonal — not same row or column as the anchor
    expect(states(cells[0])).toEqual([0, 0, 0, 0]);
    expect(states(cells[1])).toEqual([0, 0, 0, 0]);

    shiftClick(cells[0][2]); // now aligned with the original anchor, (0,0)
    expect(states(cells[0])).toEqual([1, 1, 1, 0]);
  });

  it("rolls the anchor forward to the second cell, for a chained third shift+click", () => {
    const { cells } = buildGrid(4);
    shiftClick(cells[0][0]);
    shiftClick(cells[0][1]); // closes (0,0)-(0,1), anchor rolls to (0,1)
    expect(states(cells[0])).toEqual([1, 1, 0, 0]);

    shiftClick(cells[0][3]); // range from the rolled anchor (0,1), not (0,0)
    // (0,1) was already 1 (eliminated) after the first range, so this range
    // toggles (0,1)-(0,3) back to unmarked.
    expect(states(cells[0])).toEqual([1, 0, 0, 0]);
  });

  it("a plain click clears a pending anchor", () => {
    const { cells } = buildGrid(4);
    shiftClick(cells[0][0]); // anchor set on (0,0)
    plainClick(cells[2][2]); // unrelated normal click — clears the anchor
    shiftClick(cells[1][0]); // this is now a fresh anchor, not a range close
    shiftClick(cells[1][3]);
    // Only row 1 changed; (0,0) was never involved in a completed range.
    expect(states(cells[0])).toEqual([0, 0, 0, 0]);
    expect(states(cells[1])).toEqual([1, 1, 1, 1]);
  });

  it("refuses to anchor on a frozen cell", () => {
    const { cells } = buildGrid(4);
    cells[0][0].restore(2, true); // frozen
    shiftClick(cells[0][0]); // must NOT become the anchor
    shiftClick(cells[0][2]); // so this is treated as a fresh anchor, not a range close
    shiftClick(cells[0][3]); // ...and this closes (0,2)-(0,3)
    expect(states(cells[0])).toEqual([2, 0, 1, 1]);
  });
});

describe("attachRangeGestures: touch-drag marking", () => {
  const pointOf = new Map<string, HTMLElement>();

  function place(cell: Cell, x: number, y: number): void {
    pointOf.set(`${x},${y}`, cell.html);
  }

  function touchEvent(type: string, x: number, y: number): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
    return event;
  }

  beforeEach(() => {
    pointOf.clear();
    vi.spyOn(document, "elementFromPoint").mockImplementation(
      (x, y) => pointOf.get(`${x},${y}`) ?? null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks every cell the finger passes over to the opposite of the first cell's value", () => {
    const { cells, board } = buildGrid(4);
    place(cells[0][0], 0, 0);
    place(cells[0][1], 10, 0);
    place(cells[0][2], 20, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    board.dispatchEvent(touchEvent("touchmove", 10, 0));
    board.dispatchEvent(touchEvent("touchmove", 20, 0));
    board.dispatchEvent(touchEvent("touchend", 20, 0));

    expect(states(cells[0].slice(0, 3))).toEqual([1, 1, 1]);
    expect(cells[0][3].state).toBe(0); // never touched, untouched
  });

  it("a plain tap (touchstart+touchend, no movement) marks nothing — defers to the click handler", () => {
    const { cells, board } = buildGrid(4);
    place(cells[0][0], 0, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    const end = touchEvent("touchend", 0, 0);
    board.dispatchEvent(end);

    expect(cells[0][0].state).toBe(0);
    expect(end.defaultPrevented).toBe(false); // the tap's synthesized click must still fire
  });

  it("prevents the tap-synthesized click once a real drag has happened", () => {
    const { cells, board } = buildGrid(4);
    place(cells[0][0], 0, 0);
    place(cells[0][1], 10, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    board.dispatchEvent(touchEvent("touchmove", 10, 0));
    const end = touchEvent("touchend", 10, 0);
    board.dispatchEvent(end);

    expect(end.defaultPrevented).toBe(true);
  });

  it("skips a frozen cell encountered mid-drag, leaving it untouched", () => {
    const { cells, board } = buildGrid(4);
    cells[0][1].restore(2, true);
    place(cells[0][0], 0, 0);
    place(cells[0][1], 10, 0);
    place(cells[0][2], 20, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    board.dispatchEvent(touchEvent("touchmove", 10, 0));
    board.dispatchEvent(touchEvent("touchmove", 20, 0));
    board.dispatchEvent(touchEvent("touchend", 20, 0));

    expect(states(cells[0].slice(0, 3))).toEqual([1, 2, 1]);
  });

  it("a drag starting on a frozen cell is inert for the whole gesture", () => {
    const { cells, board } = buildGrid(4);
    cells[0][0].restore(2, true);
    place(cells[0][0], 0, 0);
    place(cells[0][1], 10, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    board.dispatchEvent(touchEvent("touchmove", 10, 0));
    board.dispatchEvent(touchEvent("touchend", 10, 0));

    expect(cells[0][1].state).toBe(0);
  });

  it("touchcancel ends the drag — no further cells get marked", () => {
    const { cells, board } = buildGrid(4);
    place(cells[0][0], 0, 0);
    place(cells[0][1], 10, 0);
    place(cells[0][2], 20, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    board.dispatchEvent(touchEvent("touchmove", 10, 0));
    board.dispatchEvent(new Event("touchcancel", { bubbles: true }));
    board.dispatchEvent(touchEvent("touchmove", 20, 0));

    expect(cells[0][0].state).toBe(1);
    expect(cells[0][1].state).toBe(1);
    expect(cells[0][2].state).toBe(0); // reached only after the cancel
  });

  it("calls preventDefault on the very first touchmove of a touch that began on a cell — even while still over the starting cell", () => {
    const { cells, board } = buildGrid(4);
    place(cells[0][0], 0, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    const move = touchEvent("touchmove", 0, 0); // same point, still over the starting cell
    board.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
  });

  it("does not call preventDefault on touchmove when the touch started outside any cell", () => {
    const { board } = buildGrid(4);
    // No place() call for (99, 99) — touchstart at an unplaced point

    board.dispatchEvent(touchEvent("touchstart", 99, 99));
    const move = touchEvent("touchmove", 99, 99);
    board.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false);
  });

  it("calls preventDefault on touchmove for a touch that started on a frozen cell", () => {
    const { cells, board } = buildGrid(4);
    cells[0][0].restore(2, true); // frozen
    place(cells[0][0], 0, 0);

    board.dispatchEvent(touchEvent("touchstart", 0, 0));
    const move = touchEvent("touchmove", 0, 0);
    board.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
  });
});

describe("attachRangeGestures: mouse-drag marking", () => {
  // Unlike touch (which needs document.elementFromPoint, since touchmove's
  // event.target is always the original touch-start element), mouse-drag
  // reads event.target directly — real mousemove events retarget to
  // whatever's actually under the cursor. To reproduce that here, each event
  // is dispatched ON the cell it should appear to be over (bubbles: true, so
  // it still reaches board's and window's listeners) — dispatching from
  // `window` or `board` itself would leave event.target as that container,
  // not the cell, since target isn't settable via the constructor.
  function fireOn(cell: Cell, type: string, button = 0): void {
    cell.html.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }));
  }

  it("marks every cell the cursor passes over to the opposite of the first cell's value", () => {
    const { cells } = buildGrid(4);
    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][1], "mousemove");
    fireOn(cells[0][2], "mousemove");
    fireOn(cells[0][2], "mouseup");

    expect(states(cells[0].slice(0, 3))).toEqual([1, 1, 1]);
    expect(cells[0][3].state).toBe(0); // never under the cursor, untouched
  });

  it("a plain click (mousedown+mouseup, no cell change) marks nothing itself — the trailing click still does the toggle", () => {
    const { cells } = buildGrid(4);
    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][0], "mouseup");
    expect(cells[0][0].state).toBe(0); // the drag machinery alone marks nothing here

    // The real browser fires `click` after mouseup regardless; simulate that.
    fireOn(cells[0][0], "click");
    expect(cells[0][0].state).toBe(1); // cell.ts's own handler did this, untouched
  });

  it("mousemove jitter that never leaves the starting cell does not count as a drag", () => {
    const { cells } = buildGrid(4);
    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][0], "mousemove"); // same cell — jitter, not a drag
    fireOn(cells[0][0], "mouseup");
    fireOn(cells[0][0], "click");

    // A real drag would have marked (0,0) to 1 and then swallowed this
    // trailing click; since jitter isn't a drag, the click reaches cell.ts's
    // handler normally and does the one toggle a plain click always does.
    expect(cells[0][0].state).toBe(1);
  });

  it("suppresses the trailing click on the drag's endpoint cell (no double-toggle)", () => {
    const { cells } = buildGrid(4);
    let clickReachedCell = false;
    cells[0][1].html.addEventListener("click", () => {
      clickReachedCell = true;
    });

    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][1], "mousemove");
    fireOn(cells[0][1], "mouseup");
    expect(states(cells[0].slice(0, 2))).toEqual([1, 1]); // the drag itself marked both

    // The real browser's trailing click on the endpoint, simulated here —
    // capture-phase suppression should stop it before it ever reaches the
    // cell's own bubble-phase listener (added above) or cell.ts's handler.
    fireOn(cells[0][1], "click");

    expect(clickReachedCell).toBe(false);
    expect(cells[0][1].state).toBe(1); // unchanged by a second (would-be) toggle
  });

  it("skips a frozen cell encountered mid-drag, leaving it untouched", () => {
    const { cells } = buildGrid(4);
    cells[0][1].restore(2, true);

    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][1], "mousemove");
    fireOn(cells[0][2], "mousemove");
    fireOn(cells[0][2], "mouseup");

    expect(states(cells[0].slice(0, 3))).toEqual([1, 2, 1]);
  });

  it("a drag starting on a frozen cell is inert for the whole gesture", () => {
    const { cells } = buildGrid(4);
    cells[0][0].restore(2, true);

    fireOn(cells[0][0], "mousedown");
    fireOn(cells[0][1], "mousemove");
    fireOn(cells[0][1], "mouseup");

    expect(cells[0][1].state).toBe(0);
  });

  it("ignores a non-primary button (e.g. right-click drag)", () => {
    const { cells } = buildGrid(4);
    fireOn(cells[0][0], "mousedown", 2); // right button
    fireOn(cells[0][1], "mousemove");
    fireOn(cells[0][1], "mouseup", 2);

    expect(states(cells[0].slice(0, 2))).toEqual([0, 0]);
  });
});

describe("attachKeyboardNavigation", () => {
  describe("directionFor", () => {
    it("recognizes arrow keys", () => {
      expect(directionFor("ArrowUp")).toBe("up");
      expect(directionFor("ArrowDown")).toBe("down");
      expect(directionFor("ArrowLeft")).toBe("left");
      expect(directionFor("ArrowRight")).toBe("right");
    });

    it("recognizes WASD case-insensitively", () => {
      expect(directionFor("w")).toBe("up");
      expect(directionFor("W")).toBe("up");
      expect(directionFor("a")).toBe("left");
      expect(directionFor("s")).toBe("down");
      expect(directionFor("d")).toBe("right");
    });

    it("recognizes vim hjkl case-insensitively", () => {
      expect(directionFor("h")).toBe("left");
      expect(directionFor("j")).toBe("down");
      expect(directionFor("k")).toBe("up");
      expect(directionFor("l")).toBe("right");
    });

    it("returns null for unrecognized keys", () => {
      expect(directionFor("x")).toBeNull();
      expect(directionFor("Enter")).toBeNull();
    });
  });

  describe("movement via DOM focus", () => {
    it("moves focus with arrow keys, clamped to the grid", () => {
      const { cells, board } = buildGrid(4);
      const dispose = attachKeyboardNavigation(board, cells, newGame(4, 4), () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      expect(document.activeElement).toBe(cells[0][0].html);

      fireBoardKey(cells[0][0], "ArrowRight");
      expect(document.activeElement).toBe(cells[0][1].html);

      // clamp at top-left
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "ArrowUp");
      fireBoardKey(cells[0][0], "ArrowLeft");
      expect(document.activeElement).toBe(cells[0][0].html);
    });
  });

  describe("keyboard shortcuts", () => {
    it("Escape and M both call onLeaveBoard when a cell has focus", () => {
      const { cells, board } = buildGrid(4);
      const game = newGame(4, 4);
      const onLeaveBoardSpy = vi.fn();
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: onLeaveBoardSpy,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();

      // Test Escape
      fireBoardKey(cells[0][0], "Escape");
      expect(onLeaveBoardSpy).toHaveBeenCalledTimes(1);

      // Test M
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "m");
      expect(onLeaveBoardSpy).toHaveBeenCalledTimes(2);

      // Test uppercase M
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "M");
      expect(onLeaveBoardSpy).toHaveBeenCalledTimes(3);
    });

    it("board-scoped keys are no-ops when dispatched while a non-cell element has focus", () => {
      const { cells, board } = buildGrid(4);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
      });
      disposers.push(dispose);

      // Focus a plain button outside the board
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();

      // X key should not affect any cell (no cell has focus)
      expect(document.activeElement).toBe(button);
      fireBoardKey(cells[0][0], "x");
      expect(cells[0][0].state).toBe(0); // unchanged

      button.remove();
    });

    it("tab order matches DOM order (row-major)", () => {
      const { cells, board } = buildGrid(4);
      const dispose = attachKeyboardNavigation(board, cells, newGame(4, 4), () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
      });
      disposers.push(dispose);

      // Collect cells in DOM order
      const domOrder = Array.from(board.children) as HTMLElement[];
      // Collect cells in row-major order from our cells array
      const cellsFlat = cells.flat().map((c) => c.html);

      expect(domOrder).toEqual(cellsFlat);
    });
  });
});

describe("Undo integration", () => {
  function fireOn(cell: Cell, type: string, button = 0): void {
    cell.html.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }));
  }

  function keyDown(key: string, options: Record<string, boolean> = {}): void {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.dispatchEvent(event);
  }

  function fireBoardKey(cell: Cell, key: string, options: Record<string, boolean> = {}): void {
    cell.html.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  }

  describe("mouse drag as one undo step", () => {
    it("marks multiple cells as a single undo entry", () => {
      const { cells, undo } = buildGrid(4, [], true);

      fireOn(cells[0][0], "mousedown");
      fireOn(cells[0][1], "mousemove");
      fireOn(cells[0][2], "mousemove");
      fireOn(cells[0][2], "mouseup");

      expect(undo!.depth()).toBe(1);
      undo!.undo();

      expect(states(cells[0].slice(0, 3))).toEqual([0, 0, 0]);
    });
  });

  describe("touch drag as one undo step", () => {
    it("marks multiple cells as a single undo entry", () => {
      const pointOf = new Map<string, HTMLElement>();
      const { cells, board, undo } = buildGrid(4, [], true);

      function place(cell: Cell, x: number, y: number): void {
        pointOf.set(`${x},${y}`, cell.html);
      }

      function touchEvent(type: string, x: number, y: number): Event {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
        return event;
      }

      vi.spyOn(document, "elementFromPoint").mockImplementation(
        (x, y) => pointOf.get(`${x},${y}`) ?? null,
      );

      place(cells[0][0], 0, 0);
      place(cells[0][1], 10, 0);
      place(cells[0][2], 20, 0);

      board.dispatchEvent(touchEvent("touchstart", 0, 0));
      board.dispatchEvent(touchEvent("touchmove", 10, 0));
      board.dispatchEvent(touchEvent("touchmove", 20, 0));
      board.dispatchEvent(touchEvent("touchend", 20, 0));

      expect(undo!.depth()).toBe(1);
      undo!.undo();

      expect(states(cells[0].slice(0, 3))).toEqual([0, 0, 0]);

      vi.restoreAllMocks();
    });
  });

  describe("shift+click range as one undo step", () => {
    it("marks a range as a single undo entry", () => {
      const { cells, undo } = buildGrid(4, [], true);

      shiftClick(cells[0][0]); // anchor
      shiftClick(cells[0][2]); // close range

      expect(undo!.depth()).toBe(1);
      undo!.undo();

      expect(states(cells[0].slice(0, 3))).toEqual([0, 0, 0]);
    });
  });

  describe("keyboard shift+direction as one undo step", () => {
    it("marks range selection as a single undo entry", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "ArrowRight", { shiftKey: true }); // Begin selection, move right
      fireBoardKey(cells[0][1], "ArrowRight", { shiftKey: true }); // Continue selection
      fireBoardKey(cells[0][2], "ArrowRight", { shiftKey: true }); // Continue selection
      // Simulate Shift key release to close the transaction
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));

      expect(undo!.depth()).toBe(1);
      undo!.undo();

      // The shift+direction should have marked cells along the path, all undone by one undo
      expect(cells[0][0].state).toBe(0); // anchor cell, restored
    });
  });

  describe("Ctrl+Z / Cmd+Z", () => {
    it("Ctrl+Z undoes a keyboard X mark", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      expect(cells[0][0].state).toBe(1);

      keyDown("z", { ctrlKey: true });
      expect(cells[0][0].state).toBe(0);
    });

    it("Cmd+Z (metaKey) also works", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      expect(cells[0][0].state).toBe(1);

      keyDown("z", { metaKey: true });
      expect(cells[0][0].state).toBe(0);
    });

    it("Ctrl+Shift+Z does nothing (no redo)", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      undo!.undo();
      expect(cells[0][0].state).toBe(0);

      keyDown("z", { ctrlKey: true, shiftKey: true });
      expect(cells[0][0].state).toBe(0); // unchanged, no redo happened
    });
  });

  describe("Ctrl+Z gating", () => {
    it("no-op when any dialog is open", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      let dialogOpen = false;
      const isAnyDialogOpen = () => dialogOpen;
      const dispose = attachKeyboardNavigation(board, cells, game, isAnyDialogOpen, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      // Record a mark while dialog is closed
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      expect(undo!.depth()).toBe(1);

      // Now open dialog and try to undo - should be suppressed
      dialogOpen = true;
      keyDown("z", { ctrlKey: true });
      expect(undo!.depth()).toBe(1); // unchanged, no undo happened
    });

    it("no-op when game.state !== 0 (game ended)", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);

      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      // Record a mark while game is in progress
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      expect(undo!.depth()).toBe(1);

      // Now end the game and try to undo - should be suppressed
      game.state = 1;
      keyDown("z", { ctrlKey: true });
      expect(undo!.depth()).toBe(1); // unchanged
    });

    it("no-op while an input has focus", () => {
      const { cells, board, undo } = buildGrid(4, [], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      // Record a mark while no input has focus
      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "x");
      expect(undo!.depth()).toBe(1);

      // Now give an input focus and try to undo - should be suppressed
      const input = document.createElement("input");
      document.body.append(input);
      input.focus();

      keyDown("z", { ctrlKey: true });
      expect(undo!.depth()).toBe(1); // unchanged

      input.remove();
    });
  });

  describe("keyboard Q (commit) is NOT undoable", () => {
    it("pressing Q commits a guess, which cannot be undone", () => {
      const { cells, board, undo } = buildGrid(4, [[0, 0]], true);
      const game = newGame(4, 4);
      const dispose = attachKeyboardNavigation(board, cells, game, () => false, {
        onHelp: () => {},
        onLeaveBoard: () => {},
        undo: undo!,
      });
      disposers.push(dispose);

      cells[0][0].html.focus();
      fireBoardKey(cells[0][0], "q");
      expect(cells[0][0].frozen).toBe(true);
      expect(cells[0][0].state).toBe(2);

      const success = undo!.undo();
      expect(success).toBe(false);
      expect(cells[0][0].frozen).toBe(true);
    });
  });
});

describe("coordsToEliminate (pure coordinate helper)", () => {
  it("includes row, column, region, and 8 neighbors for a mid-board cell", () => {
    const size = 4;
    const groupOf = (): number => 0; // all cells in same region
    const coords = coordsToEliminate(1, 1, size, 0, groupOf);
    const coordSet = new Set(coords.map((c) => `${c.row},${c.col}`));

    // Same row
    expect(coordSet.has("1,0")).toBe(true);
    expect(coordSet.has("1,2")).toBe(true);
    expect(coordSet.has("1,3")).toBe(true);

    // Same column
    expect(coordSet.has("0,1")).toBe(true);
    expect(coordSet.has("2,1")).toBe(true);
    expect(coordSet.has("3,1")).toBe(true);

    // 8 neighbors
    expect(coordSet.has("0,0")).toBe(true);
    expect(coordSet.has("0,2")).toBe(true);
    expect(coordSet.has("2,0")).toBe(true);
    expect(coordSet.has("2,2")).toBe(true);

    // Never includes self
    expect(coordSet.has("1,1")).toBe(false);
  });

  it("clamps coordinates to board boundaries", () => {
    const size = 4;
    const groupOf = (): number => 0;
    const coords = coordsToEliminate(0, 0, size, 0, groupOf);
    const coordSet = new Set(coords.map((c) => `${c.row},${c.col}`));

    // Only valid cells within bounds
    coords.forEach((c) => {
      expect(c.row >= 0 && c.row < size).toBe(true);
      expect(c.col >= 0 && c.col < size).toBe(true);
    });

    // Should not include negative or out-of-bounds
    expect(coordSet.has("-1,0")).toBe(false);
    expect(coordSet.has("0,-1")).toBe(false);
    expect(coordSet.has("4,0")).toBe(false);
    expect(coordSet.has("0,4")).toBe(false);
  });

  it("includes all cells in the same region", () => {
    const size = 4;
    // Cells (0,0), (0,1), (1,0), (1,1) are in region 1
    const groupOf = (r: number, c: number): number => {
      if ((r === 0 || r === 1) && (c === 0 || c === 1)) return 1;
      return 0;
    };
    const coords = coordsToEliminate(0, 0, size, 1, groupOf);
    const coordSet = new Set(coords.map((c) => `${c.row},${c.col}`));

    // All region cells
    expect(coordSet.has("0,1")).toBe(true);
    expect(coordSet.has("1,0")).toBe(true);
    expect(coordSet.has("1,1")).toBe(true);
  });

  it("deduplicates overlapping coordinates (row/column/neighbor/region overlap)", () => {
    const size = 4;
    const coords = coordsToEliminate(0, 0, size, 0, () => 0);

    // Count unique coordinates
    const coordSet = new Set(coords.map((c) => `${c.row},${c.col}`));
    expect(coordSet.size).toBe(coords.length); // no duplicates
  });

  it("never includes the origin cell itself", () => {
    const size = 4;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const coords = coordsToEliminate(r, c, size, 0, () => 0);
        const hasOrigin = coords.some((coord) => coord.row === r && coord.col === c);
        expect(hasOrigin).toBe(false);
      }
    }
  });
});

describe("attachAutoEliminate", () => {
  it("marks eligible cells when a correct queen is committed", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    // Mark some cells as manual marks first
    cells[1][0].mark(0); // unmarked
    cells[2][1].mark(0); // unmarked

    // Commit the queen at (1,1)
    cells[1][1].commit();

    // Same row should be marked
    expect(cells[1][0].state).toBe(1);
    expect(cells[1][2].state).toBe(1);

    // Same column should be marked
    expect(cells[0][1].state).toBe(1);
    expect(cells[2][1].state).toBe(1);
    expect(cells[3][1].state).toBe(1);

    // Neighbors should be marked
    expect(cells[0][0].state).toBe(1);
    expect(cells[0][2].state).toBe(1);
    expect(cells[2][0].state).toBe(1);
    expect(cells[2][2].state).toBe(1);
  });

  it("skips already-eliminated cells", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    // Pre-mark a cell in the same row
    cells[1][0].mark(1); // already eliminated
    expect(cells[1][0].state).toBe(1);

    // Commit the queen
    cells[1][1].commit();

    // The already-eliminated cell should still be eliminated, not re-marked
    expect(cells[1][0].state).toBe(1);
  });

  it("is inert when isEnabled returns false", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => false; // disabled
    attachAutoEliminate(cells, undo!, isEnabled);

    // Commit the queen at (1,1)
    cells[1][1].commit();

    // No neighbors should be marked
    expect(cells[1][0].state).toBe(0);
    expect(cells[1][2].state).toBe(0);
    expect(cells[0][1].state).toBe(0);
  });

  it("wrong-guess commit does not trigger auto-elimination", () => {
    const { cells, undo } = buildGrid(4, [], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    // Commit a wrong guess at (0,0)
    cells[0][0].commit();

    // No neighbors should be marked (wrong guess doesn't trigger onQueenFound)
    expect(cells[0][1].state).toBe(0);
    expect(cells[1][0].state).toBe(0);
  });

  it("wraps auto-marked cells in a single undo transaction", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    expect(undo!.depth()).toBe(0);

    // Commit the queen
    cells[1][1].commit();

    expect(undo!.depth()).toBe(1); // one transaction
  });

  it("undo reverts exactly the auto-marked cells", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    // Manually mark a cell before the queen commit
    cells[0][0].mark(1);
    expect(undo!.depth()).toBe(1);

    // Commit the queen
    cells[1][1].commit();
    expect(undo!.depth()).toBe(2); // one manual mark, one auto-eliminate

    // Undo the auto-eliminate
    undo!.undo();
    expect(undo!.depth()).toBe(1);

    // Auto-marked cells should be back to unmarked
    expect(cells[1][0].state).toBe(0);
    expect(cells[0][1].state).toBe(0);

    // The manually marked cell should be unaffected
    expect(cells[0][0].state).toBe(1);
  });

  it("queen cell is never undoable", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    cells[1][1].commit();
    expect(cells[1][1].frozen).toBe(true);
    expect(cells[1][1].state).toBe(2);

    // Undo
    undo!.undo();

    // Queen cell should still be frozen and correct
    expect(cells[1][1].frozen).toBe(true);
    expect(cells[1][1].state).toBe(2);
  });

  it("undone cells become freely markable again", () => {
    const { cells, undo } = buildGrid(4, [[1, 1]], true);
    const isEnabled = () => true;
    attachAutoEliminate(cells, undo!, isEnabled);

    cells[1][1].commit();
    const targetCell = cells[1][0];
    expect(targetCell.state).toBe(1); // auto-marked

    // Undo
    undo!.undo();
    expect(targetCell.state).toBe(0); // unmarked

    // Toggle should work
    targetCell.toggle();
    expect(targetCell.state).toBe(1); // marked by toggle

    // The toggle should be undoable
    expect(undo!.depth()).toBe(1);
  });
});
