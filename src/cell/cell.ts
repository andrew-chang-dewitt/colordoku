import type { Game } from "../game/game";
import classes from "./cell.module.css";

type State = 0 | 1 | 2; // not marked, eliminated, queen

function stateToView(state: State): string {
  // The queen glyph is a chess-queen symbol, not the letter "Q": it reads as
  // a game piece rather than plain text and pairs with the .found scale-in
  // animation/glow in cell.module.css.
  let views = ["", "X", "♛"];

  return views[state];
}

export interface Cell {
  group: number; // maps to colors
  state: State;
  queen: boolean; // true if cell actually has queen
  frozen: boolean; // true if had an incorrect queen guess or queen found

  html: HTMLElement; // ref to rendered element
  update: () => void;
}

export function newCell(
  game: Game,
  group: number,
  queen: boolean = false,
): Cell {
  const state = 0 as State;
  const frozen = false;
  const html = renderCell(state, group);
  const cell = {
    group,
    state,
    queen,
    frozen,
    html,

    update() {
      this.html.innerHTML = stateToView(this.state);
    },
  };

  function singleClick(_: MouseEvent): void {
    if (!cell.frozen) {
      if (cell.state == 0) {
        cell.state = 1;
      } else if (cell.state == 1) {
        cell.state = 0;
      }

      cell.update();
    }
  }

  function doubleClick(_: MouseEvent): void {
    if (!cell.frozen) {
      if (cell.queen) {
        cell.state = 2;
        html.className += ` ${classes.found}`;
        game.incFound();
      } else {
        cell.state = 1;
        html.className += ` ${classes.error}`;
        game.incGuess();
      }

      cell.frozen = true;
      cell.update();
    }
  }

  html.addEventListener("click", singleClick);
  html.addEventListener("dblclick", doubleClick);

  return cell;
}

function renderCell(state: State, group: number): HTMLButtonElement {
  let html: HTMLButtonElement = document.createElement("button");
  // html.id = `${this.id[0]}-${this.id[1]}`;
  html.innerHTML = stateToView(state);
  html.className = `${classes.cell} group-${group}`;

  return html;
}
