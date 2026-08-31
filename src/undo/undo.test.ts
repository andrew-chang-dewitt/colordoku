import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import { newGame } from "../game/game";
import { newUndoStack, newUndoButton } from "./undo";

function buildGrid(
  size: number,
  queens: Array<[number, number]> = [],
): Cell[][] {
  const game = newGame(size, size);
  const isQueen = (r: number, c: number) =>
    queens.some(([qr, qc]) => qr === r && qc === c);
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => newCell(game, 0, isQueen(r, c))),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("UndoStack recording", () => {
  it("single toggle records one entry with depth 1", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].toggle();

    expect(undo.depth()).toBe(1);
    expect(undo.canUndo()).toBe(true);
  });

  it("undo reverts and decrements depth", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].toggle();
    expect(cells[0][0].state).toBe(1);

    const reverted = undo.undo();
    expect(reverted).toBe(true);
    expect(cells[0][0].state).toBe(0);
    expect(undo.depth()).toBe(0);
    expect(undo.canUndo()).toBe(false);
  });

  it("mark() same as toggle() - records on change", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].mark(1);

    expect(undo.depth()).toBe(1);
  });

  it("mark to current state records nothing", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].mark(0); // already 0

    expect(undo.depth()).toBe(0);
  });

  it("undo itself is not recorded - toggle, toggle, undo, undo both revert, third undo returns false", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].toggle(); // 0 -> 1
    cells[1][0].toggle(); // 0 -> 1

    expect(undo.depth()).toBe(2);

    const rev1 = undo.undo();
    expect(rev1).toBe(true);
    expect(cells[1][0].state).toBe(0);

    const rev2 = undo.undo();
    expect(rev2).toBe(true);
    expect(cells[0][0].state).toBe(0);

    const rev3 = undo.undo();
    expect(rev3).toBe(false);
  });

  it("undo on empty stack returns false", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    const result = undo.undo();
    expect(result).toBe(false);
  });
});

describe("UndoStack transactions (begin/end)", () => {
  it("begin/mark 3 cells/end creates one undo entry", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    undo.begin();
    cells[0][0].toggle();
    cells[0][1].toggle();
    cells[0][2].toggle();
    undo.end();

    expect(undo.depth()).toBe(1);
  });

  it("single undo reverts all 3 cells", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    undo.begin();
    cells[0][0].toggle();
    cells[0][1].toggle();
    cells[0][2].toggle();
    undo.end();

    undo.undo();

    expect(cells[0][0].state).toBe(0);
    expect(cells[0][1].state).toBe(0);
    expect(cells[0][2].state).toBe(0);
  });

  it("empty transaction (begin; end with no marks) pushes nothing", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    undo.begin();
    undo.end();

    expect(undo.depth()).toBe(0);
  });

  it("a cell marked multiple times within one transaction keeps earliest previous value on undo", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    undo.begin();
    cells[0][0].toggle(); // 0 -> 1
    cells[0][0].toggle(); // 1 -> 0
    cells[0][0].toggle(); // 0 -> 1
    undo.end();

    expect(undo.depth()).toBe(1);

    undo.undo();

    // Should revert to the very first state (0)
    expect(cells[0][0].state).toBe(0);
  });

  it("begin() while a transaction is already open flushes the first one", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    undo.begin();
    cells[0][0].toggle();
    undo.begin(); // flush first, start new

    expect(undo.depth()).toBe(1);

    cells[0][1].toggle();
    undo.end();

    expect(undo.depth()).toBe(2);
  });
});

describe("Committed guesses are never undoable", () => {
  it("queen placement via commit() is not undoable", () => {
    const cells = buildGrid(4, [[0, 0]]);
    const undo = newUndoStack(cells);

    cells[0][0].commit();

    const result = undo.undo();
    expect(result).toBe(false);
    expect(cells[0][0].frozen).toBe(true);
    expect(cells[0][0].state).toBe(2);
  });

  it("incorrect guess via commit() is not undoable", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].commit();

    const result = undo.undo();
    expect(result).toBe(false);
    expect(cells[0][0].frozen).toBe(true);
    expect(cells[0][0].state).toBe(1);
  });

  it("mark made just before commit on SAME cell is dropped when commit happens", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].toggle();
    expect(undo.depth()).toBe(1);

    cells[0][0].commit();

    expect(undo.depth()).toBe(0);

    const result = undo.undo();
    expect(result).toBe(false);
  });

  it("marks on OTHER cells survive a commit and remain undoable", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].toggle();
    cells[0][1].toggle();
    cells[0][0].commit();

    expect(undo.depth()).toBe(1);

    undo.undo();
    expect(cells[0][1].state).toBe(0);
  });

  it("marks made AFTER a commit are still undoable", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);

    cells[0][0].commit();
    cells[0][1].toggle();

    expect(undo.depth()).toBe(1);

    undo.undo();
    expect(cells[0][1].state).toBe(0);
  });

  it("undo never calls game.incFound/incGuess", () => {
    buildGrid(4, [[0, 0]]); // unused, but ensures proper setup
    const gameObj = newGame(4, 4);
    const spyFound = vi.spyOn(gameObj, "incFound");
    const spyGuess = vi.spyOn(gameObj, "incGuess");

    const testCells = Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 4 }, (_, c) => newCell(gameObj, 0, r === 0 && c === 0)),
    );
    const undo = newUndoStack(testCells);

    testCells[0][0].toggle();
    testCells[0][1].toggle();
    undo.undo();
    undo.undo();

    expect(spyFound).not.toHaveBeenCalled();
    expect(spyGuess).not.toHaveBeenCalled();
  });

  it("a frozen cell via restore(state, true) is never touched by undo/mark afterward", () => {
    const cells = buildGrid(4);
    newUndoStack(cells); // create undo stack so freeze hooks are installed

    cells[0][0].restore(1, true);
    cells[0][0].mark(0);

    expect(cells[0][0].state).toBe(1);
  });
});

describe("UndoButton", () => {
  it("starts disabled", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);
    const button = newUndoButton(undo);

    expect(button.disabled).toBe(true);
  });

  it("enables after a recorded mark", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);
    const button = newUndoButton(undo);

    cells[0][0].toggle();

    expect(button.disabled).toBe(false);
  });

  it("disables after last undo", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);
    const button = newUndoButton(undo);

    cells[0][0].toggle();
    undo.undo();

    expect(button.disabled).toBe(true);
  });

  it("click performs undo", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);
    const button = newUndoButton(undo);

    cells[0][0].toggle();
    expect(cells[0][0].state).toBe(1);

    button.click();

    expect(cells[0][0].state).toBe(0);
  });

  it("clear() disables the button", () => {
    const cells = buildGrid(4);
    const undo = newUndoStack(cells);
    const button = newUndoButton(undo);

    cells[0][0].toggle();
    expect(button.disabled).toBe(false);

    undo.clear();

    expect(button.disabled).toBe(true);
  });
});
