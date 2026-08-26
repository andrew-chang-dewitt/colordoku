import type { Cell } from "../cell/cell";
import type { Game } from "../game/game";
import { newGame } from "../game/game";
import { generateCells } from "./generate";

export interface Board {
  state: Cell[][];
  /** The seed actually used to generate this board — resolved even if the caller omitted one. */
  seed: number;
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

/** A cell's position in the grid, as used by the shift+click / drag range-marking gestures. */
export interface Coord {
  row: number;
  col: number;
}

/**
 * The inclusive run of coordinates between two cells, for the shift+click
 * range-toggle gesture. Only defined when `from` and `to` share a row or a
 * column (per the feature's explicit spec — a diagonal or otherwise
 * unaligned pair is not a valid range); returns null rather than guessing
 * what the user meant. `from` and `to` can be given in either order — the
 * result is always sorted from the lower to the higher index. The
 * single-cell case (`from` equals `to`) is a valid, if degenerate, range of
 * one — nothing in the gesture's spec excludes it, and rejecting it would
 * just be a surprising edge case for no benefit.
 *
 * Pure and grid-size-agnostic on purpose: it's just coordinate geometry, so
 * it's testable without a real board, and the caller (which does know the
 * grid, and has the actual Cell objects) is responsible for turning the
 * returned coordinates into an effect — e.g. skipping any that are frozen.
 */
export function cellsBetween(from: Coord, to: Coord): Coord[] | null {
  if (from.row === to.row) {
    const [lo, hi] = from.col <= to.col ? [from.col, to.col] : [to.col, from.col];
    const cells: Coord[] = [];
    for (let col = lo; col <= hi; col++) cells.push({ row: from.row, col });
    return cells;
  }

  if (from.col === to.col) {
    const [lo, hi] = from.row <= to.row ? [from.row, to.row] : [to.row, from.row];
    const cells: Coord[] = [];
    for (let row = lo; row <= hi; row++) cells.push({ row, col: from.col });
    return cells;
  }

  return null;
}

interface Anchor {
  coord: Coord;
  /** The anchor cell's mark state, captured when it became the anchor — never 2 (queen-found): see attachRangeGestures. */
  value: 0 | 1;
}

/**
 * Wires up the two multi-cell marking gestures across the whole board:
 * shift+click a pair of cells in the same row/column to toggle every
 * non-frozen cell between them (inclusive) to the opposite of the
 * first-clicked cell's value, and touch-dragging a finger across cells to do
 * the same thing along whatever path it actually travels (not constrained
 * to a row/column — the two gestures aren't given the same shape in the
 * spec, so this doesn't force touch-drag into the row/column-only shape
 * shift+click uses).
 *
 * Lives here, not in cell.ts, because both gestures fundamentally need the
 * whole grid — shift+click needs cellsBetween() across it, and drag needs to
 * resolve arbitrary screen points to cells as the finger moves — which only
 * board.ts has (cell.ts only ever knows about itself). cell.ts's only
 * addition for this is the narrow mark() method; it stays unaware that
 * shift-state or drag gestures exist at all.
 *
 * Both gestures reuse the same coordinate map and a shared "cell at this
 * point" lookup, and both take care not to interfere with cell.ts's own
 * click handling (normal single click, and its debounced double-click
 * commit) on a cell that isn't actually part of a shift/drag gesture — see
 * the comments at each interception point below for exactly how.
 */
export function attachRangeGestures(board: HTMLDivElement, cells: Cell[][]): void {
  const coordOf = new Map<HTMLElement, Coord>();
  cells.forEach((row, r) => row.forEach((cell, c) => coordOf.set(cell.html, { row: r, col: c })));

  function hitFor(target: EventTarget | null): { coord: Coord; cell: Cell } | null {
    if (!(target instanceof HTMLElement)) return null;
    const coord = coordOf.get(target);
    // Cell buttons render plain text only (see cell.ts's stateToView), so a
    // point/event landing on a cell always targets the button element
    // itself directly — never a child of it — hence no ancestor walk here.
    if (coord === undefined) return null;
    return { coord, cell: cells[coord.row][coord.col] };
  }

  function hitAtPoint(x: number, y: number): { coord: Coord; cell: Cell } | null {
    return hitFor(document.elementFromPoint(x, y));
  }

  // --- shift+click range toggle -------------------------------------------

  let anchor: Anchor | null = null;

  board.addEventListener(
    "click",
    (event) => {
      const hit = hitFor(event.target);
      if (hit === null) return;

      if (!event.shiftKey) {
        // A plain click breaks any pending shift-range gesture (the player
        // has moved on to normal single-cell interaction) and is left
        // completely alone here — not intercepted, so it reaches cell.ts's
        // own click handler exactly as it always has.
        anchor = null;
        return;
      }

      // Shift is held: this click belongs entirely to the range gesture,
      // not to the cell's own single/double-click handling. Stopping it
      // here, in the capture phase (this listener is registered with
      // capture: true below), keeps the event from ever reaching the
      // target cell's own bubble-phase listener in cell.ts — so a
      // shift+click never also toggles/commits via the normal click path.
      event.stopPropagation();

      const { coord, cell } = hit;

      if (anchor === null) {
        // First cell of a new range: just set the anchor, capturing its
        // value now (the "opposite of whatever the first-clicked cell's
        // value was" the spec calls for) — nothing is toggled until a
        // second shift+click closes the range. A frozen cell can't
        // meaningfully anchor a mark/unmark range (its value is a
        // committed guess, not 0/1 mark state), so refuse rather than
        // anchor on one.
        if (!cell.frozen) anchor = { coord, value: cell.state === 1 ? 1 : 0 };
        return;
      }

      const run = cellsBetween(anchor.coord, coord);
      if (run === null) {
        // Second click isn't in the same row/column as the anchor. Left as
        // a no-op with the anchor untouched, rather than discarding it or
        // silently starting a new one from this click — the player's first
        // click is still exactly where they left it, so retrying with a
        // valid second cell just works.
        return;
      }

      const target = anchor.value === 0 ? 1 : 0;
      for (const { row, col } of run) {
        const runCell = cells[row][col];
        if (!runCell.frozen) runCell.mark(target);
      }

      // Rolls the anchor forward to the cell just clicked, so a third
      // shift+click (still holding Shift) extends into a new range from
      // here instead of requiring Shift to be released and re-pressed. Its
      // value is captured fresh, after the toggle above — the same value a
      // first shift+click landing on it would have captured. If it's
      // frozen there's nothing valid left to anchor on, so the gesture
      // simply ends (matches the "anchor refuses a frozen cell" rule above).
      anchor = cell.frozen ? null : { coord, value: cell.state === 1 ? 1 : 0 };
    },
    { capture: true },
  );

  // --- touch-drag marking --------------------------------------------------
  //
  // Marks every cell the finger passes over to the opposite of whatever the
  // first-touched cell's value was — along the actual path the finger
  // travels, not constrained to a row/column (see this function's doc
  // comment for why that's not the same shape as shift+click).

  let dragTarget: 0 | 1 | null = null;
  let dragStart: { coord: Coord; cell: Cell } | null = null;
  let dragMoved = false; // true once real movement is seen — see touchmove below
  const dragged = new Set<string>(); // "row,col" already marked this drag

  function markIfNew(hit: { coord: Coord; cell: Cell } | null): void {
    if (hit === null || dragTarget === null) return;
    const key = `${hit.coord.row},${hit.coord.col}`;
    if (dragged.has(key)) return;
    dragged.add(key);
    if (!hit.cell.frozen) hit.cell.mark(dragTarget);
  }

  function endDrag(): void {
    dragTarget = null;
    dragStart = null;
    dragMoved = false;
    dragged.clear();
  }

  board.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      if (touch === undefined) return;
      dragStart = hitAtPoint(touch.clientX, touch.clientY);
      dragMoved = false;
      dragged.clear();
      // A frozen start point has no 0/1 value to derive a drag's target
      // polarity from — same rule as a shift+click anchor above — so the
      // whole gesture stays inert (dragTarget left null; see markIfNew).
      dragTarget = dragStart !== null && !dragStart.cell.frozen
        ? (dragStart.cell.state === 1 ? 0 : 1)
        : null;
      // Marking is deliberately deferred to the first touchmove (below),
      // not done here: a plain tap (touchstart+touchend, no movement) must
      // still reach cell.ts's own click handler completely untouched, for
      // its double-tap-to-guess detection. Marking eagerly here — before
      // it's known whether this is a tap or a drag — would double-toggle a
      // merely-tapped cell once that tap's synthesized click also fires.
    },
    { passive: true },
  );

  board.addEventListener(
    "touchmove",
    (event) => {
      if (dragTarget === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;

      if (!dragMoved) {
        // Now committed to treating this as a drag rather than a tap: mark
        // the deferred starting cell before the new one the finger has
        // reached.
        dragMoved = true;
        markIfNew(dragStart);
      }

      markIfNew(hitAtPoint(touch.clientX, touch.clientY));
      // Keeps the page from scrolling out from under a drag that's
      // actively marking cells. Requires this listener to be non-passive.
      event.preventDefault();
    },
    { passive: false },
  );

  board.addEventListener("touchend", (event) => {
    if (dragMoved) {
      // A real drag happened, so the browser's tap-synthesized click for
      // this touch must not also reach cell.ts's click handler — that
      // would toggle/commit the last-touched cell a second time on top of
      // what the drag above already did to it.
      event.preventDefault();
    }
    endDrag();
  });

  board.addEventListener("touchcancel", endDrag);
}

export async function newBoard(
  size: number,
  seed?: number,
  signal?: AbortSignal,
): Promise<Board> {
  const game = newGame(size, maxGuessesFor(size));
  const { cells, seed: resolvedSeed } = await generateCells(game, size, seed, signal);

  const board: HTMLDivElement = document.createElement("div");
  board.id = "board";
  // Cells are appended flat; the grid gets its column count from CSS.
  board.style.setProperty("--board-size", String(size));

  cells.forEach((row) =>
    row.forEach((cell) => {
      board.append(cell.html);
    }),
  );

  attachRangeGestures(board, cells);

  // The HUD groups the guess pips with whatever sits alongside them above the
  // board (currently just the timer, appended into this div by main.ts) so
  // they read as one chrome block with shared spacing/alignment, rather than
  // as loose siblings stacked by document order.
  const hud: HTMLDivElement = document.createElement("div");
  hud.id = "hud";
  hud.append(game.html);

  const html: HTMLDivElement = document.createElement("div");
  html.append(hud);
  html.append(board);

  return { state: cells, seed: resolvedSeed, game, html };
}
