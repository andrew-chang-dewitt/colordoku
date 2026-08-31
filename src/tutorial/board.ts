/**
 * The 4x4 practice board used in the tutorial, built from README's worked example.
 * Reuses the real board's Game, Cell, and generation machinery (cellsFromArrays,
 * applyRegionBoundaries) without touching the wasm generator or workers.
 *
 * Layout:
 * ```
 *   B B B B          0 0 0 0
 *   A B C C   -->    1 0 3 3
 *   C B C D          3 0 3 2
 *   C C C D          3 3 3 2
 * ```
 *
 * Region ids follow the generator's convention: a region's id equals the row
 * index of its seed queen.
 */

import { newGame } from "../game/game";
import type { Game } from "../game/game";
import { cellsFromArrays } from "../board/generate";
import { applyRegionBoundaries, maxGuessesFor } from "../board/board";
import type { Cell } from "../cell/cell";
import type { Coord } from "../board/board";
import classes from "./tutorial.module.css";

export interface TutorialBoard {
  html: HTMLDivElement; // panel: pips + grid
  board: HTMLDivElement; // the grid itself
  game: Game;
  cells: Cell[][];
  cellAt(coord: Coord): Cell;
  /** Gate: only `coord` responds to clicks; null lifts the restriction (every cell is clickable). */
  allowOnly(coord: Coord | null): void;
  dispose(): void;
}

export function newTutorialBoard(): TutorialBoard {
  // README's 4x4 example layout
  const size = 4;
  const regions = new Uint8Array([0, 0, 0, 0, 1, 0, 3, 3, 3, 0, 3, 2, 3, 3, 3, 2]);
  const queenCols = new Uint8Array([2, 0, 3, 1]);

  // Game: 4 queens, 2 guesses (easy difficulty for size 4)
  const game = newGame(size, maxGuessesFor(size, "easy"));

  // Build cells from the fixed layout
  const cells = cellsFromArrays(game, size, regions, queenCols);

  // Apply region boundaries (heavy edges)
  applyRegionBoundaries(cells);

  // Panel structure: pips + grid
  const html = document.createElement("div");
  html.className = classes.panel;

  html.append(game.html);

  // Grid element
  const board = document.createElement("div");
  board.className = "board";
  board.style.setProperty("--board-size", "4");

  for (const row of cells) {
    for (const cell of row) {
      board.append(cell.html);
    }
  }

  html.append(board);

  // Access helper
  function cellAt(coord: Coord): Cell {
    return cells[coord.row][coord.col];
  }

  // Click gate: capture-phase listener that blocks clicks to all but one cell
  let allowedCoord: Coord | null = null;
  let clickListener: ((e: Event) => void) | null = null;

  function allowOnly(coord: Coord | null): void {
    allowedCoord = coord;
  }

  function setupClickGate(): void {
    if (clickListener) return;

    clickListener = (e: Event) => {
      if (!(e instanceof MouseEvent) && !(e instanceof PointerEvent)) return;
      if (allowedCoord === null) {
        // No restriction — every caller of allowOnly(null) (see tutorial.ts)
        // does so meaning "the board is free to interact with now," not
        // "block everything." Let the click through untouched.
        return;
      } else {
        // Only allow clicks to the specified cell
        const targetCell = e.target;
        const allowed = cellAt(allowedCoord);
        if (e.target !== allowed.html && board.contains(targetCell as HTMLElement)) {
          e.stopPropagation();
        }
      }
    };

    board.addEventListener("click", clickListener, { capture: true });
  }

  setupClickGate();

  return {
    html,
    board,
    game,
    cells,
    cellAt,
    allowOnly,
    dispose: () => {
      if (clickListener) {
        board.removeEventListener("click", clickListener, { capture: true });
      }
    },
  };
}
