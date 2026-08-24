import classes from "./cell.module.css";

type State = 0 | 1 | 2; // not marked, eliminated, queen

function stateToView(state: State): string {
  let views = ["", "X", "Q"];

  return views[state];
}

export interface Cell {
  // id: [number, number];
  state: State;
  queen: boolean; // true if cell actually has queen
  group: number; // maps to colors

  html: HTMLElement; // ref to rendered element
  update: () => void;
}

export function newCell(
  // id: [number, number],
  group: number,
  queen: boolean = false,
): Cell {
  const state = 0 as State;
  const html = renderCell(state, group);
  const cell = {
    state,
    // id,
    queen,
    group,
    html,

    update() {
      this.html.innerHTML = stateToView(this.state);
    },
  };

  function singleClick(_: MouseEvent): void {
    if (cell.state == 0) {
      cell.state = 1;
    } else if (cell.state == 1) {
      cell.state = 0;
    }

    cell.update();
  }

  function doubleClick(_: MouseEvent): void {
    if (cell.queen) {
      cell.state = 2;
    } else {
      cell.state = 1;
      html.className += ` ${classes.error}`;
    }

    cell.update();
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
