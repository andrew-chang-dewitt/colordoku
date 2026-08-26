import type { Cell } from "../cell/cell";
import type { Game } from "../game/game";
import { newGame } from "../game/game";
import { generateCells } from "./generate";

export interface Board {
  state: Cell[][];
  game: Game;
  html: HTMLDivElement;
}

/**
 * 4 -> 2, 8 -> 4, 12 -> 6. A placeholder: the README lists a real difficulty
 * modifier as its own TODO.
 */
export function maxGuessesFor(size: number): number {
  return Math.max(1, Math.ceil(size / 2));
}

export async function newBoard(
  size: number,
  seed?: number,
  signal?: AbortSignal,
): Promise<Board> {
  const game = newGame(size, maxGuessesFor(size));
  const cells = await generateCells(game, size, seed, signal);

  const board: HTMLDivElement = document.createElement("div");
  board.id = "board";
  // Cells are appended flat; the grid gets its column count from CSS.
  board.style.setProperty("--board-size", String(size));

  cells.forEach((row) =>
    row.forEach((cell) => {
      board.append(cell.html);
    }),
  );

  const html: HTMLDivElement = document.createElement("div");
  html.append(game.html);
  html.append(board);

  return { state: cells, game, html };
}
