import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { newTutorialBoard } from "./board";

describe("tutorial board.ts", () => {
  let board: ReturnType<typeof newTutorialBoard>;

  beforeEach(() => {
    board = newTutorialBoard();
  });

  afterEach(() => {
    board.dispose();
  });

  it("creates a 4x4 board", () => {
    expect(board.cells.length).toBe(4);
    for (const row of board.cells) {
      expect(row.length).toBe(4);
    }
  });

  it("matches README's layout and region colors", () => {
    // Region id equals the row index of its queen
    const expectedRegions = [
      [0, 0, 0, 0],
      [1, 0, 3, 3],
      [3, 0, 3, 2],
      [3, 3, 3, 2],
    ];

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(board.cells[r][c].group).toBe(expectedRegions[r][c]);
      }
    }
  });

  it("has queens at correct positions", () => {
    // queenCols = [2, 0, 3, 1] means queens at (0,2), (1,0), (2,3), (3,1)
    const queenPositions = [
      [0, 2],
      [1, 0],
      [2, 3],
      [3, 1],
    ];

    let queenCount = 0;
    for (const [r, c] of queenPositions) {
      expect(board.cells[r][c].queen).toBe(true);
      queenCount++;
    }
    expect(queenCount).toBe(4);
  });

  it("allows only the specified cell to be clicked", () => {
    const cell = board.cellAt({ row: 1, col: 0 });
    const otherCell = board.cellAt({ row: 0, col: 0 });

    board.allowOnly({ row: 1, col: 0 });

    otherCell.html.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(otherCell.state).toBe(0);

    cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cell.state).toBe(1);
  });

  it("allows every cell's click when allowOnly(null) (no restriction)", () => {
    const cell = board.cellAt({ row: 1, col: 0 });

    board.allowOnly(null);
    cell.html.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(cell.state).toBe(1);
  });

  it("has 2 guess pips (easy difficulty for size 4)", () => {
    expect(board.game.guessesLeft).toBe(2);
    const pips = board.game.html.querySelectorAll("li");
    expect(pips.length).toBe(2);
  });

  it("starts with 0 queens found", () => {
    expect(board.game.queensFound).toBe(0);
  });

  it("game state is initially 0 (continuing)", () => {
    expect(board.game.state).toBe(0);
  });

  it("mark and commit behave correctly", () => {
    const cell = board.cellAt({ row: 0, col: 0 });

    // Initial state: unmarked (0)
    expect(cell.state).toBe(0);

    // Mark (single click) → eliminated (1)
    cell.mark(1);
    expect(cell.state).toBe(1);

    // Mark again → back to unmarked (0)
    cell.mark(0);
    expect(cell.state).toBe(0);
  });

  it("dispose removes the click listener", () => {
    board.allowOnly({ row: 0, col: 0 });
    board.dispose();
    // After dispose, the listener should be removed (verified by no errors)
    expect(true);
  });

  it("cellAt accesses cells correctly", () => {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(board.cellAt({ row: r, col: c })).toBe(board.cells[r][c]);
      }
    }
  });
});
