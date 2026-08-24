import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";

export interface Board {
  state: Cell[][];
  html: HTMLDivElement;
}

export function newBoard(_size: number): Board {
  // start w/ hardcoded 4 x 4 board
  //
  // 0Q 1. 1. 1.
  // 2. 1. 2Q 2.
  // 2. 1Q 2. 3.
  // 2. 2. 2. 3Q
  let cells = [
    [
      newCell(/* [0, 0], */ 0, true),
      newCell(/* [0, 1], */ 1),
      newCell(/* [0, 2], */ 1),
      newCell(/* [0, 3], */ 1),
    ],
    [
      newCell(/* [1, 0], */ 2),
      newCell(/* [1, 1], */ 1),
      newCell(/* [1, 2], */ 2, true),
      newCell(/* [1, 3], */ 2),
    ],
    [
      newCell(/* [2, 0], */ 2),
      newCell(/* [2, 1], */ 1, true),
      newCell(/* [2, 2], */ 2),
      newCell(/* [2, 3], */ 3),
    ],
    [
      newCell(/* [3, 0], */ 2),
      newCell(/* [3, 1], */ 2),
      newCell(/* [3, 2], */ 2),
      newCell(/* [3, 3], */ 3, true),
    ],
  ];

  console.log("board cells created");
  console.dir(cells);

  const html: HTMLDivElement = document.createElement("div");

  cells.forEach((row) =>
    row.forEach((cell) => {
      html.append(cell.html);
    }),
  );

  return {
    state: cells,
    html,
  };
}
