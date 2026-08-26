import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import { newGame } from "../game/game";
import { attachRangeGestures, cellsBetween, maxGuessesFor } from "./board";

/**
 * A minimal real board for exercising attachRangeGestures directly, without
 * going through newBoard()'s async wasm/worker generation (which the rest of
 * this file's comments already note isn't worth pulling into unit tests).
 * Cells are real newCell() instances — not mocks — so the frozen guard, view
 * rendering, etc. all behave exactly as they do in the app.
 */
function buildGrid(size: number, queens: Array<[number, number]> = []): { cells: Cell[][]; board: HTMLDivElement } {
  const game = newGame(size, size); // generous guess budget; guess-commit isn't under test here
  const isQueen = (r: number, c: number) => queens.some(([qr, qc]) => qr === r && qc === c);
  const cells: Cell[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => newCell(game, 0, isQueen(r, c))),
  );
  const board = document.createElement("div");
  cells.forEach((row) => row.forEach((cell) => board.append(cell.html)));
  document.body.append(board);
  attachRangeGestures(board, cells);
  return { cells, board };
}

function shiftClick(cell: Cell): void {
  cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
}

function plainClick(cell: Cell): void {
  cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const states = (cells: Cell[]): number[] => cells.map((c) => c.state);

describe("maxGuessesFor", () => {
  it("keeps the original 4x4 board at two guesses", () => {
    expect(maxGuessesFor(4)).toBe(2);
  });

  it("scales with board size", () => {
    expect(maxGuessesFor(8)).toBe(4);
    expect(maxGuessesFor(12)).toBe(6);
  });

  it("always leaves at least one guess", () => {
    expect(maxGuessesFor(1)).toBe(1);
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
  afterEach(() => {
    document.body.innerHTML = "";
  });

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
    document.body.innerHTML = "";
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
});
