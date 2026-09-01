/**
 * The tutorial's script: 15 steps across 3 acts, walking a new player through
 * the rules and strategy via a 4x4 practice board (README's worked example).
 *
 * Step data is pure and exported; TutorialBoard applies it. The controller
 * (tutorial.ts) drives the presentation (callout.ts + script).
 */

import type { Coord } from "../board/board";
import type { Placement } from "../callout/callout";
import type { TutorialBoard } from "./board";

export interface TutorialStep {
  id: string;
  title?: string;
  body: string;
  /** Which element the ring points at. */
  anchor:
    | { kind: "none" }
    | { kind: "userMenu" }
    | { kind: "helpButton" }
    | { kind: "panel" }
    | { kind: "pips" }
    | { kind: "cell"; coord: Coord }
    | { kind: "cells"; coords: Coord[] };
  placement?: Placement;
  /** Mounts/unmounts the practice panel as the acts change. */
  panel: "hidden" | "shown";
  /** true → the practice panel (and only the panel) is interactive. */
  interactive?: boolean;
  /** Side effects on entry — scripted auto-marks. */
  enter?: (b: TutorialBoard) => void;
  /** When set, the step waits for the player instead of showing "Next". */
  await?: { coord: Coord; action: "mark" | "commit" };
  /** Advances on game.onEnd instead of a button (the winning step). */
  awaitWin?: true;
}

export const STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "Colordoku — how to play",
    body: "Similar to sudoku, Colordoku is a logic puzzle where you attempt to find how items are arranged in a grid. Your goal is to find every queen without making too many incorrect guesses. In the next few pages, we'll learn how in a practice puzzle.",
    // A null anchor (kind: "none") always centers regardless of `placement`
    // — see placeBubble's doc comment — so no `placement` is set here.
    anchor: { kind: "none" },
    panel: "hidden",
  },

  {
    id: "regions",
    title: "Colours = regions",
    body: "<strong>One queen per row, per column, per region</strong> (a region is a connected group of the same colour).",
    anchor: { kind: "panel" },
    panel: "shown",
    placement: "left",
    interactive: true,
  },

  {
    id: "no-adjacent",
    title: "No adjacent queens",
    body: "<strong>No two queens can touch</strong>, not even diagonally. If a queen is here, every orthogonally and diagonally adjacent cell is eliminated.",
    // Points at an actual cell rather than the whole panel — "here" in the
    // body text needs somewhere concrete to mean. (1,0) is also the cell
    // the player commits a guess on two steps later, so this doubles as an
    // early look at it. Purely illustrative: no enter() side effect, so it
    // doesn't touch state that step still needs to find fresh.
    anchor: { kind: "cell", coord: { row: 1, col: 0 } },
    panel: "shown",
    placement: "right",
    interactive: true,
  },

  {
    id: "pips",
    title: "The guess pips",
    body: "Each wrong queen costs one guess. At zero, you lose. Mark strategically without guessing — it's free.",
    anchor: { kind: "pips" },
    panel: "shown",
    placement: "bottom",
    interactive: true,
  },

  {
    id: "commit-single-cell",
    title: "Commit a guess",
    body: "This region has exactly one cell → the queen must be there. <strong>Double-click or double-tap to commit a guess.</strong>",
    anchor: { kind: "cell", coord: { row: 1, col: 0 } },
    panel: "shown",
    placement: "right",
    interactive: true,
    await: { coord: { row: 1, col: 0 }, action: "commit" },
  },

  {
    id: "frozen-cell",
    title: "Queen found",
    body: "A correct guess is locked in and frozen — you can't change it. Row 1, column 0, and the diagonal are now eliminated.",
    anchor: { kind: "cell", coord: { row: 1, col: 0 } },
    panel: "shown",
    placement: "right",
    interactive: true,
  },

  {
    id: "single-mark",
    title: "Free eliminations",
    body: "<strong>Single click = a free elimination mark</strong>, no guess cost. This cell is diagonally adjacent to the queen, so it's out.",
    anchor: { kind: "cell", coord: { row: 1, col: 1 } },
    panel: "shown",
    placement: "right",
    interactive: true,
    await: { coord: { row: 1, col: 1 }, action: "mark" },
  },

  {
    id: "range-mark",
    title: "Bulk marking",
    body: "The rest of that row, column, and neighbourhood are marked for you. Shift+click two cells in a row/column, or drag to mark a path.",
    anchor: {
      kind: "cells",
      coords: [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 1, col: 2 },
        { row: 1, col: 3 },
        { row: 2, col: 0 },
        { row: 2, col: 1 },
        { row: 3, col: 0 },
      ],
    },
    panel: "shown",
    placement: "top",
    interactive: true,
    enter: (b) => {
      b.cellAt({ row: 0, col: 0 }).mark(1);
      b.cellAt({ row: 0, col: 1 }).mark(1);
      b.cellAt({ row: 1, col: 2 }).mark(1);
      b.cellAt({ row: 1, col: 3 }).mark(1);
      b.cellAt({ row: 2, col: 0 }).mark(1);
      b.cellAt({ row: 2, col: 1 }).mark(1);
      b.cellAt({ row: 3, col: 0 }).mark(1);
    },
  },

  {
    id: "mistake",
    title: "Guess wrong on purpose",
    body: "Let's see what happens when you guess wrong. Commit a guess here.",
    anchor: { kind: "cell", coord: { row: 3, col: 2 } },
    panel: "shown",
    placement: "left",
    interactive: true,
    await: { coord: { row: 3, col: 2 }, action: "commit" },
  },

  {
    id: "wrong-guess",
    title: "Wrong guess",
    body: "A wrong guess <strong>eliminates the cell for you</strong> and burns a pip — one left. Mark strategically instead when you're unsure.",
    anchor: { kind: "pips" },
    panel: "shown",
    placement: "bottom",
    interactive: true,
  },

  {
    id: "column-queen",
    title: "Column queen",
    body: "Region D spans only column 3, so the queen *must* be in column 3. Everything else is out.",
    // Region D's own two cells (2,3) and (3,3) — the reasoning's actual
    // basis — not (0,3), which is merely a *consequence* of it (eliminated
    // below because D now owns column 3's queen).
    anchor: {
      kind: "cells",
      coords: [
        { row: 2, col: 3 },
        { row: 3, col: 3 },
      ],
    },
    panel: "shown",
    placement: "top",
    interactive: true,
    enter: (b) => {
      b.cellAt({ row: 0, col: 3 }).mark(1);
    },
  },

  {
    id: "last-cell",
    title: "Last cell",
    body: "Only one B remains — it must be the queen. Commit it.",
    anchor: { kind: "cell", coord: { row: 0, col: 2 } },
    panel: "shown",
    placement: "right",
    interactive: true,
    await: { coord: { row: 0, col: 2 }, action: "commit" },
  },

  {
    id: "finish",
    title: "Almost there",
    body: "Two cells left, one queen each. You know what to do.",
    anchor: {
      kind: "cells",
      coords: [
        { row: 2, col: 3 },
        { row: 3, col: 1 },
      ],
    },
    panel: "shown",
    placement: "top",
    interactive: true,
    enter: (b) => {
      // Mark the other cells to make it obvious
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const cell = b.cellAt({ row: r, col: c });
          if (!cell.frozen && cell.state === 0) {
            if (!((r === 2 && c === 3) || (r === 3 && c === 1))) {
              cell.mark(1);
            }
          }
        }
      }
    },
    awaitWin: true,
  },

  {
    id: "help-button",
    title: "You did it!",
    body: "Rules, strategy tips, and every keyboard shortcut live in the Help section — <strong>and you can replay this tour from there</strong>.",
    anchor: { kind: "helpButton" },
    panel: "hidden",
    placement: "left",
  },
];
