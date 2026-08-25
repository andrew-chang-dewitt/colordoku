import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import { newGame } from "../game/game";

export interface Board {
  state: Cell[][];
  html: HTMLDivElement;
}

export function newBoard(_size: number): Board {
  let game = newGame(4, 2);
  // start w/ hardcoded 4 x 4 board
  //
  // B. B. BQ B.
  // AQ B. C. C.
  // C. B. C. DQ
  // C. CQ C. D.
  let cells = [
    [
      newCell(game, 1),
      newCell(game, 1),
      newCell(game, 1, true),
      newCell(game, 1),
    ],
    [
      newCell(game, 0, true),
      newCell(game, 1),
      newCell(game, 2),
      newCell(game, 2),
    ],
    [
      newCell(game, 2),
      newCell(game, 1),
      newCell(game, 2),
      newCell(game, 3, true),
    ],
    [
      newCell(game, 2),
      newCell(game, 2, true),
      newCell(game, 2),
      newCell(game, 3),
    ],
  ];
  const board: HTMLDivElement = document.createElement("div");
  board.id = "board";

  cells.forEach((row) =>
    row.forEach((cell) => {
      board.append(cell.html);
    }),
  );

  const html: HTMLDivElement = document.createElement("div");
  html.append(game.html);
  html.append(board);

  return {
    state: cells,
    html,
  };
}
