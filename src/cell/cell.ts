import type { Game } from "../game/game";
import classes from "./cell.module.css";

type State = 0 | 1 | 2; // not marked, eliminated, queen

// A guess-committing "double click/tap" is detected by our own click
// timestamps rather than the native `dblclick` event: dblclick's timing
// window is OS-controlled (no JS API to read or tighten it), and on touch
// devices its synthesis is inconsistent across browsers (e.g. Chrome has
// fired it twice per double-tap in some versions) and races the native
// double-tap-to-zoom gesture. Tracking clicks ourselves gives one
// consistent, tunable signal on every platform.
//
// Starting points only — not yet validated against real touch/mouse
// hardware; tune after manual/device testing.
export const DOUBLE_CLICK_MS = 350; // 2nd click within this window confirms a guess
export const DUPLICATE_CLICK_MS = 50; // click within this window of the last one is
// treated as a duplicate/bounced event for the same physical click/tap and ignored

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
  /**
   * Re-hydrates state/frozen (and the matching found/error styling) without
   * going through a real click — for restoring a saved-game snapshot after
   * reload. Bypasses the frozen guard that click handlers respect, since a
   * restore is allowed to move a cell straight from fresh into a frozen state.
   */
  restore: (state: State, frozen: boolean) => void;
  /**
   * Directly sets state to 0 (unmarked) or 1 (eliminated) — the same effect
   * a real single click's toggle has, but driven externally by board.ts's
   * multi-cell gestures (shift+click range-toggle, touch/mouse drag) rather
   * than a click on this cell itself. Respects the frozen guard exactly
   * like a real click does. Deliberately narrower than restore(): this is
   * pure mark/unmark, so it never touches found/error styling, never
   * freezes the cell, and never calls game.incFound()/incGuess() — it must
   * not be mistaken for a guess.
   */
  mark: (state: 0 | 1) => void;
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

    restore(state: State, frozen: boolean) {
      this.state = state;
      this.frozen = frozen;
      // Mirrors doubleClick's className additions so a restored frozen cell
      // looks identical to one frozen by an actual guess.
      if (frozen && state === 2) {
        this.html.className += ` ${classes.found}`;
      } else if (frozen && state === 1) {
        this.html.className += ` ${classes.error}`;
      }
      this.update();
    },

    mark(state: 0 | 1) {
      if (this.frozen) return;
      this.state = state;
      this.update();
    },
  };

  // -Infinity (not 0) so the very first click is never mistaken for a
  // duplicate of a click at Date.now() === 0 (e.g. under fake timers in tests).
  let lastClickAt = -Infinity;

  function toggleMark(): void {
    if (cell.state == 0) {
      cell.state = 1;
    } else if (cell.state == 1) {
      cell.state = 0;
    }

    cell.update();
  }

  function commitGuess(): void {
    if (cell.queen) {
      cell.state = 2;
      html.className += ` ${classes.found}`;
    } else {
      cell.state = 1;
      html.className += ` ${classes.error}`;
    }

    cell.frozen = true;
    cell.update();

    // Defer game.incFound()/incGuess() — game.onEnd's listeners (main.ts) can
    // synchronously trigger heavy work (confetti generation, persistence
    // writes, opening the game-over modal) via a *synchronous* notifyEnd()
    // call. Running that inline, in the same task as this click, blocks the
    // browser from painting the cell.update() above before that heavy work
    // starts — which is exactly what makes the winning click's queen glyph
    // appear to lag behind the stale "X". Deferring by one task lets the
    // browser paint first.
    setTimeout(() => {
      if (cell.queen) {
        game.incFound();
      } else {
        game.incGuess();
      }
    }, 0);
  }

  function handleClick(_: MouseEvent): void {
    if (cell.frozen) return;

    const now = Date.now();
    const sinceLast = now - lastClickAt;

    if (sinceLast < DUPLICATE_CLICK_MS) {
      // Likely a duplicate/bounced event for what was physically one
      // click/tap — ignore it entirely: don't toggle, don't count it,
      // don't move lastClickAt.
      return;
    }

    if (sinceLast < DOUBLE_CLICK_MS) {
      commitGuess();
      lastClickAt = 0; // avoid chaining a stray 3rd click into another commit
      return;
    }

    toggleMark();
    lastClickAt = now;
  }

  html.addEventListener("click", handleClick);

  return cell;
}

function renderCell(state: State, group: number): HTMLButtonElement {
  let html: HTMLButtonElement = document.createElement("button");
  // html.id = `${this.id[0]}-${this.id[1]}`;
  html.innerHTML = stateToView(state);
  html.className = `${classes.cell} group-${group}`;

  return html;
}
