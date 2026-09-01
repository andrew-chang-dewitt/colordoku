import type { Cell } from "../cell/cell";
import classes from "../cell/cell.module.css";
import type { Game } from "../game/game";
import { newGame } from "../game/game";
import { generateCells } from "./generate";
import { takePregeneratedCells } from "./pregenerate";
import type { Difficulty } from "../options/options";
import type { UndoStack } from "../undo/undo";
import { newUndoStack, newUndoButton } from "../undo/undo";

export interface Board {
  state: Cell[][];
  /** The seed actually used to generate this board — resolved even if the caller omitted one. */
  seed: number;
  game: Game;
  htmlBoard: HTMLDivElement;
  htmlHud: HTMLDivElement;
  /** Session-only undo stack for elimination marks (never guesses). */
  undo: UndoStack;
  /** The undo button — not mounted here; main.ts places it beside "Start over". */
  undoButton: HTMLButtonElement;
}

/** Scales a size-only baseline guess count per difficulty tier; see docs/plans/board-generation-difficulty.md. */
const GUESS_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1.5,
  medium: 1,
  hard: 0.75,
};

/**
 * Guess budget for a board of the given size and difficulty (#board-generation,
 * see docs/plans/board-generation-difficulty.md — this is Phase 1, the
 * guess-count half; board generation itself isn't difficulty-aware yet).
 *
 * The baseline (medium) grows sub-linearly with size — 3/8 guess per size
 * unit past a floor of 4 — rather than the old ceil(size/2), which was too
 * lenient at larger sizes (a 12x12 got 6 guesses). Chosen to land on the
 * plan's explicit anchors: medium 12x12 -> 3, medium 6x6-or-smaller -> 1.
 * Easy and hard scale that baseline by 1.5x/0.75x, floored at 1 guess.
 */
export function maxGuessesFor(size: number, difficulty: Difficulty): number {
  const baseline = Math.max(1, Math.round(((size - 4) * 3) / 8));
  return Math.max(1, Math.round(baseline * GUESS_MULTIPLIER[difficulty]));
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
    const [lo, hi] =
      from.col <= to.col ? [from.col, to.col] : [to.col, from.col];
    const cells: Coord[] = [];
    for (let col = lo; col <= hi; col++) cells.push({ row: from.row, col });
    return cells;
  }

  if (from.col === to.col) {
    const [lo, hi] =
      from.row <= to.row ? [from.row, to.row] : [to.row, from.row];
    const cells: Coord[] = [];
    for (let row = lo; row <= hi; row++) cells.push({ row, col: from.col });
    return cells;
  }

  return null;
}

/**
 * Every coordinate eliminated by a correct queen at (row, col) on a board of
 * the given size: same row, same column, same region (passed in as `group`
 * since region membership isn't derivable from coordinates alone), and all 8
 * orthogonal/diagonal neighbors. Never includes (row, col) itself. Pure and
 * grid-size-agnostic like cellsBetween — the caller (board.ts, which has the
 * real Cell objects) is responsible for skipping frozen/already-eliminated
 * cells and turning this into an effect.
 */
export function coordsToEliminate(
  row: number,
  col: number,
  size: number,
  group: number,
  groupOf: (r: number, c: number) => number,
): Coord[] {
  const seen = new Set<string>();
  const out: Coord[] = [];
  const add = (r: number, c: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    if (r === row && c === col) return;
    const key = `${r},${c}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ row: r, col: c });
  };

  for (let c = 0; c < size; c++) add(row, c); // row
  for (let r = 0; r < size; r++) add(r, col); // column
  for (let dr = -1; dr <= 1; dr++) // 8 neighbors
    for (let dc = -1; dc <= 1; dc++)
      if (dr !== 0 || dc !== 0) add(row + dr, col + dc);
  for (let r = 0; r < size; r++) // region/color
    for (let c = 0; c < size; c++) if (groupOf(r, c) === group) add(r, c);

  return out;
}

export type Direction = "up" | "down" | "left" | "right";

/**
 * Resolves a keydown's key to a cursor direction, or null if it's not a movement key.
 * Covers arrows, WASD, and vim h/j/k/l as three equally-valid input styles —
 * checked case-insensitively for the letter keys so Caps Lock doesn't break it.
 */
export function directionFor(key: string): Direction | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
    case "k":
    case "K":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
    case "j":
    case "J":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
    case "h":
    case "H":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
    case "l":
    case "L":
      return "right";
    default:
      return null;
  }
}

/**
 * Sets each cell's four --edge-{top,right,bottom,left}-{w,c} custom
 * properties (see cell.module.css's .cell box-shadow, which reads them) to
 * pick the *heavy* region-boundary treatment (--region-edge-width /
 * --color-region-edge) wherever one is called for; every side left alone
 * keeps cell.module.css's own default — light-uniform for right/bottom,
 * fully unpainted for top/left.
 *
 * #board has no grid `gap` any more (style.css's --board-gap: 0) — cells sit
 * truly adjacent, so every edge in the grid, including the board's own outer
 * perimeter, must be painted by *exactly one* owning cell or corners and
 * mismatched-adjacent-bands reappear (see cell.module.css's comment on
 * .cell for the full reasoning). The ownership rule, extended from the
 * original right/bottom-only version to also cover the board's perimeter:
 *
 *  - right/bottom: every cell owns these. Heavy when there's no neighbor
 *    there at all (last column/row — the board's own edge) *or* when the
 *    neighbor's `.group` differs (an actual region crossing); otherwise left
 *    at the light default (same-region internal edge).
 *  - top/left: a cell owns these *only* when there's no neighbor there
 *    (first row/column) — an ordinary internal top/left edge is always
 *    already owned by the neighbor's own bottom/right side, so touching it
 *    here would double-paint that shared edge. The only case top/left is
 *    ever set at all is therefore the board's own perimeter, always heavy
 *    (no neighbor is definitionally a region's outer edge, never a
 *    same-region internal one).
 */
export function applyRegionBoundaries(cells: Cell[][]): void {
  const HEAVY_W = "var(--region-edge-width)";
  const HEAVY_C = "var(--color-region-edge)";

  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      const right = row[c + 1];
      if (right === undefined || right.group !== cell.group) {
        cell.html.style.setProperty("--edge-right-w", HEAVY_W);
        cell.html.style.setProperty("--edge-right-c", HEAVY_C);
      }

      const below = cells[r + 1]?.[c];
      if (below === undefined || below.group !== cell.group) {
        cell.html.style.setProperty("--edge-bottom-w", HEAVY_W);
        cell.html.style.setProperty("--edge-bottom-c", HEAVY_C);
      }

      if (c === 0) {
        cell.html.style.setProperty("--edge-left-w", HEAVY_W);
        cell.html.style.setProperty("--edge-left-c", HEAVY_C);
      }

      if (r === 0) {
        cell.html.style.setProperty("--edge-top-w", HEAVY_W);
        cell.html.style.setProperty("--edge-top-c", HEAVY_C);
      }
    });
  });
}

export interface Anchor {
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
 *
 * Returns a dispose function that removes the two listeners attached to
 * `window` (see the mouse-drag block for why they're on window rather than
 * `board`). newBoard() doesn't bother calling it — a real page only ever
 * builds one board per load, and a full navigation tears everything down —
 * but it matters for tests, which build many short-lived boards in the same
 * long-lived jsdom/happy-dom `window` and would otherwise leak a stale
 * listener (closing over that test's now-discarded cells) into every test
 * that runs afterward.
 */
export function attachRangeGestures(
  board: HTMLDivElement,
  cells: Cell[][],
  undo?: UndoStack,
): () => void {
  const coordOf = new Map<HTMLElement, Coord>();
  cells.forEach((row, r) =>
    row.forEach((cell, c) => coordOf.set(cell.html, { row: r, col: c })),
  );

  function hitFor(
    target: EventTarget | null,
  ): { coord: Coord; cell: Cell } | null {
    if (!(target instanceof HTMLElement)) return null;
    const coord = coordOf.get(target);
    // Cell buttons render plain text only (see cell.ts's stateToView), so a
    // point/event landing on a cell always targets the button element
    // itself directly — never a child of it — hence no ancestor walk here.
    if (coord === undefined) return null;
    return { coord, cell: cells[coord.row][coord.col] };
  }

  function hitAtPoint(
    x: number,
    y: number,
  ): { coord: Coord; cell: Cell } | null {
    return hitFor(document.elementFromPoint(x, y));
  }

  /**
   * Shared "cell that the pointer has actually reached and marks, one range
   * marking pass at a time" state machine, driven by touch-drag and
   * mouse-drag — the only difference between the two is what DOM events feed
   * it and how each stops its trailing click/tap from double-toggling the
   * endpoint (see the touch and mouse blocks below for that half).
   */
  function createDragTracker() {
    let target: 0 | 1 | null = null;
    let start: { coord: Coord; cell: Cell } | null = null;
    let moved = false;
    const marked = new Set<string>();

    function markIfNew(hit: { coord: Coord; cell: Cell } | null): void {
      if (hit === null || target === null) return;
      const key = `${hit.coord.row},${hit.coord.col}`;
      if (marked.has(key)) return;
      marked.add(key);
      if (!hit.cell.frozen) hit.cell.mark(target);
    }

    return {
      begin(hit: { coord: Coord; cell: Cell } | null): void {
        undo?.begin();
        start = hit;
        moved = false;
        marked.clear();
        // A frozen start point has no 0/1 value to derive a drag's target
        // polarity from — same rule as a shift+click anchor above — so the
        // whole gesture stays inert (target left null; see markIfNew).
        target =
          hit !== null && !hit.cell.frozen
            ? hit.cell.state === 1
              ? 0
              : 1
            : null;
      },
      /** Returns true if this move is part of an active drag (marking cells along the path). */
      move(hit: { coord: Coord; cell: Cell } | null): boolean {
        if (target === null) return false;

        if (!moved) {
          // Only commit to treating this as a real drag once the pointer has
          // reached a genuinely different cell than where it started — not
          // merely because a move event fired at all. A mouse in particular
          // can emit mousemove events from sub-pixel sensor jitter during
          // what's really a stationary click; requiring an actual cell
          // change is a cheap, reliable way to tell the two apart without a
          // magic pixel-distance threshold. (Touch is generally stricter
          // about this already, but the same check costs nothing extra and
          // keeps both gestures' "is this really a drag" rule identical.)
          if (
            hit === null ||
            start === null ||
            (hit.coord.row === start.coord.row &&
              hit.coord.col === start.coord.col)
          ) {
            return false;
          }
          moved = true;
          markIfNew(start);
        }

        markIfNew(hit);
        return true;
      },
      /** Ends the session; returns true if real movement happened (so the caller should suppress the trailing click/tap). */
      end(): boolean {
        undo?.end();
        const wasDrag = moved;
        target = null;
        start = null;
        moved = false;
        marked.clear();
        return wasDrag;
      },
    };
  }

  // --- shift+click range toggle, and mouse-drag's trailing-click guard ----
  //
  // suppressNextClick is set by the mouse-drag block further down, right
  // before a drag's mouseup — mouse's native `click` event fires after
  // mouseup no matter what (unlike touch, preventDefault on mouseup/mouseup
  // doesn't stop it), so the only way to stop that trailing click from also
  // toggling/committing the drag's endpoint cell via cell.ts's own handler
  // is to swallow it here, in the same capture-phase listener that already
  // has to make this exact call for shift+click.

  let suppressNextClick = false;
  let anchor: Anchor | null = null;

  board.addEventListener(
    "click",
    (event) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.stopPropagation();
        return;
      }

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
      undo?.begin();
      for (const { row, col } of run) {
        const runCell = cells[row][col];
        if (!runCell.frozen) runCell.mark(target);
      }
      undo?.end();

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

  const touchDrag = createDragTracker();
  let touchStartedOnCell = false;

  board.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      if (touch === undefined) return;
      const hit = hitAtPoint(touch.clientX, touch.clientY);
      // Scroll-suppression only cares whether the touch landed on a real
      // cell at all (frozen or not) — unlike touchDrag.begin()'s target,
      // which additionally refuses a frozen cell. A drag that starts on a
      // frozen cell is inert for marking (see createDragTracker's frozen
      // handling) but the finger is still physically on the board and
      // should not hand the gesture to the browser's native scroll.
      touchStartedOnCell = hit !== null;
      touchDrag.begin(hit);
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
      const touch = event.touches[0];
      if (touch === undefined) return;
      // Suppress native scroll starting on the very first touchmove of a
      // touch that began on a cell — not deferred until createDragTracker
      // decides a "real drag" has happened (crossed into a different cell).
      // Browsers commit to native scroll based on the earliest unprevented
      // cancelable touchmove; waiting for `moved` to flip is too late.
      if (touchStartedOnCell) event.preventDefault();
      touchDrag.move(hitAtPoint(touch.clientX, touch.clientY));
    },
    { passive: false },
  );

  board.addEventListener("touchend", (event) => {
    if (touchDrag.end()) {
      // A real drag happened, so the browser's tap-synthesized click for
      // this touch must not also reach cell.ts's click handler — that
      // would toggle/commit the last-touched cell a second time on top of
      // what the drag above already did to it.
      event.preventDefault();
    }
    touchStartedOnCell = false;
  });

  board.addEventListener("touchcancel", () => {
    touchDrag.end();
    touchStartedOnCell = false;
  });

  // --- mouse-drag marking --------------------------------------------------
  //
  // Same gesture and rules as touch-drag above (opposite-of-first-cell
  // polarity, path-shaped not row/column-constrained, frozen cells refused
  // as the anchor and skipped along the path) — just driven by mouse events
  // instead of touch ones, and with a different trick for not double-firing
  // on the endpoint cell: touch can preventDefault its way out of the
  // trailing synthesized click, but a mouse's native `click` always fires
  // after `mouseup` no matter what, so a drag's end instead sets
  // suppressNextClick (declared above, alongside the shift+click listener
  // that actually consumes it) for the capture-phase click listener to
  // swallow.
  //
  // mousemove/mouseup are attached to `window`, not `board`: a real drag can
  // end (button released) after the pointer has left the board entirely —
  // attaching only to `board` would miss that release and leave the drag
  // considered "still active" indefinitely.
  //
  // A drag that happens to start while Shift is held is treated as a plain
  // drag, not a combined gesture — mousedown doesn't check event.shiftKey at
  // all. "Shift+drag" isn't part of this feature's spec as a distinct
  // gesture, and this is the simplest coherent behavior for what's really an
  // unspecified combination: mouse-drag already runs entirely on mousedown
  // before any click fires, so a drag that occurs takes priority regardless
  // of Shift's state — the trailing click gets swallowed by
  // suppressNextClick before the shift+click branch ever gets a chance to
  // look at it.

  const mouseDrag = createDragTracker();
  let mouseDown = false;

  board.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return; // primary button only
    mouseDown = true;
    mouseDrag.begin(hitFor(event.target));
  });

  function onMouseMove(event: MouseEvent): void {
    if (!mouseDown) return;
    mouseDrag.move(hitFor(event.target));
  }

  function onMouseUp(event: MouseEvent): void {
    if (!mouseDown || event.button !== 0) return;
    mouseDown = false;
    if (mouseDrag.end()) suppressNextClick = true;
  }

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);

  return () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };
}

/**
 * Wires up auto-elimination: when a correct queen is committed on a cell,
 * automatically marks every non-frozen, non-already-eliminated cell in the
 * queen's row, column, region, or within 8-cell diagonal/orthogonal neighbors
 * as eliminated. Each auto-elimination event is wrapped in a single undo
 * transaction, so it can be undone as a unit.
 *
 * The queen cell itself is never part of the auto-marked set — coordsToEliminate
 * explicitly excludes it, and mark() doesn't touch it anyway (it's frozen).
 * Already-eliminated or frozen cells are skipped, never re-marked.
 */
export function attachAutoEliminate(
  cells: Cell[][],
  undo: UndoStack,
  isEnabled: () => boolean,
): void {
  const size = cells.length;

  cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      cell.onQueenFound = () => {
        if (!isEnabled()) return;

        const targets = coordsToEliminate(r, c, size, cell.group, (rr, cc) => cells[rr][cc].group);
        undo.begin();
        for (const { row: tr, col: tc } of targets) {
          const target = cells[tr][tc];
          if (target.frozen) continue;
          if (target.state === 1) continue;
          target.mark(1);
        }
        undo.end();
      };
    }),
  );
}

/**
 * Wires up keyboard navigation for the board: a cursor position that moves
 * with arrow/WASD/vim keys, X to toggle marks, Q to commit guesses, Shift+direction
 * for range selection, and ? to open the help overlay.
 *
 * The listener is attached to `document`, not the board element, and is gated by:
 * - Whether any dialog is currently open (all keys suppressed until it closes)
 * - Whether the game has ended (only ? remains live)
 * - Whether a form field currently has focus (all keys suppressed)
 *
 * Returns a dispose function that removes the document-level listeners. Call this
 * in tests to avoid leaking listeners across test runs, but newBoard() itself does
 * not call it — a single page load only ever builds one board, and full navigation
 * cleans everything up.
 */
export function attachKeyboardNavigation(
  _board: HTMLDivElement,
  cells: Cell[][],
  game: Game,
  isAnyDialogOpen: () => boolean,
  { onHelp, undo, onCommit }: { onHelp: () => void; undo?: UndoStack; onCommit?: () => void },
): () => void {
  const size = cells.length;

  // Cursor position, starting at top-left
  let cursor: Coord = { row: 0, col: 0 };

  // For shift+direction range selection
  let keyboardSelectionAnchor: Anchor | null = null;
  let lastAppliedRange: Coord[] = [];

  function updateCursorVisual(): void {
    // Clear the previous cursor cell's visual
    cells.forEach((row) =>
      row.forEach((cell) => {
        cell.html.classList.remove(classes.cursor);
        cell.html.removeAttribute("aria-current");
      }),
    );

    // Apply cursor visual to the current cell
    const currentCell = cells[cursor.row][cursor.col];
    currentCell.html.classList.add(classes.cursor);
    currentCell.html.setAttribute("aria-current", "true");
  }

  function moveCursor(direction: Direction): void {
    let newRow = cursor.row;
    let newCol = cursor.col;

    switch (direction) {
      case "up":
        newRow = Math.max(0, newRow - 1);
        break;
      case "down":
        newRow = Math.min(size - 1, newRow + 1);
        break;
      case "left":
        newCol = Math.max(0, newCol - 1);
        break;
      case "right":
        newCol = Math.min(size - 1, newCol + 1);
        break;
    }

    cursor = { row: newRow, col: newCol };
    updateCursorVisual();
  }

  function unmarkCells(coords: Coord[]): void {
    for (const { row, col } of coords) {
      const cell = cells[row][col];
      if (!cell.frozen) {
        cell.mark(keyboardSelectionAnchor!.value);
      }
    }
  }

  function markCells(coords: Coord[]): void {
    const target =
      keyboardSelectionAnchor!.value === 0 ? 1 : 0;
    for (const { row, col } of coords) {
      const cell = cells[row][col];
      if (!cell.frozen) {
        cell.mark(target);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Gate 1: Any dialog open? All keys suppressed.
    if (isAnyDialogOpen()) return;

    // Gate 2: Game ended? Only ? (help) still works.
    if (game.state !== 0 && event.key !== "?") return;

    // Gate 3: A form field has focus? All keys suppressed.
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement ||
      (document.activeElement instanceof HTMLElement &&
        document.activeElement.isContentEditable)
    ) {
      return;
    }

    // ? - help overlay
    if (event.key === "?") {
      event.preventDefault();
      onHelp();
      return;
    }

    // Ctrl+Z / Cmd+Z - undo
    if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
      if (event.shiftKey) return; // no redo — leave Ctrl+Shift+Z alone
      event.preventDefault();
      undo?.undo();
      return;
    }

    // Movement keys
    const direction = directionFor(event.key);
    if (direction !== null) {
      event.preventDefault();

      // If not holding Shift, end any active selection
      if (!event.shiftKey) {
        undo?.end();
        keyboardSelectionAnchor = null;
        lastAppliedRange = [];
      }

      const oldCursor = { ...cursor };
      moveCursor(direction);

      // If Shift is held, handle range selection
      if (event.shiftKey) {
        // First Shift+direction: set the anchor
        if (keyboardSelectionAnchor === null) {
          const anchorCell = cells[oldCursor.row][oldCursor.col];
          if (!anchorCell.frozen) {
            undo?.begin();
            keyboardSelectionAnchor = {
              coord: oldCursor,
              value: anchorCell.state === 1 ? 1 : 0,
            };
          } else {
            // Frozen anchor cell, gesture inert
            return;
          }
        }

        // Compute new range from anchor to current cursor
        const newRange = cellsBetween(keyboardSelectionAnchor.coord, cursor);
        if (newRange === null) return; // shouldn't happen with keyboard movement

        // Diff old vs new range: unmark cells that left the range, mark new ones
        const oldSet = new Set(
          lastAppliedRange.map((c) => `${c.row},${c.col}`)
        );
        const newSet = new Set(newRange.map((c) => `${c.row},${c.col}`));

        // Cells that were in the old range but aren't in the new one
        const toUnmark: Coord[] = [];
        for (const coord of lastAppliedRange) {
          const key = `${coord.row},${coord.col}`;
          if (!newSet.has(key)) {
            toUnmark.push(coord);
          }
        }

        // Cells that are in the new range but weren't in the old one
        const toMark: Coord[] = [];
        for (const coord of newRange) {
          const key = `${coord.row},${coord.col}`;
          if (!oldSet.has(key)) {
            toMark.push(coord);
          }
        }

        unmarkCells(toUnmark);
        markCells(toMark);
        lastAppliedRange = newRange;
      }
      return;
    }

    // X - toggle mark on cursor cell only
    if (event.key === "x" || event.key === "X") {
      event.preventDefault();
      const cursorCell = cells[cursor.row][cursor.col];
      cursorCell.toggle();
      return;
    }

    // Q - commit guess on cursor cell only
    if (event.key === "q" || event.key === "Q") {
      event.preventDefault();
      const cursorCell = cells[cursor.row][cursor.col];
      cursorCell.commit();
      onCommit?.();
      return;
    }
  }

  function handleKeyUp(event: KeyboardEvent): void {
    // End shift+direction range selection when Shift is released
    if (event.key === "Shift") {
      undo?.end();
      keyboardSelectionAnchor = null;
      lastAppliedRange = [];
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // Apply initial cursor visual
  updateCursorVisual();

  return () => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("keyup", handleKeyUp);
  };
}

export async function newBoard(
  size: number,
  difficulty: Difficulty,
  seed?: number,
  signal?: AbortSignal,
  isAutoEliminateEnabled: () => boolean = () => false,
): Promise<Board> {
  const game = newGame(size, maxGuessesFor(size, difficulty));
  const pregenerated = seed === undefined ? takePregeneratedCells(game, size, difficulty) : null;
  const { cells, seed: resolvedSeed } =
    pregenerated ?? (await generateCells(game, size, difficulty, seed, signal));

  applyRegionBoundaries(cells);

  const board: HTMLDivElement = document.createElement("div");
  board.id = "board";
  // Cells are appended flat; the grid gets its column count from CSS.
  board.style.setProperty("--board-size", String(size));

  cells.forEach((row) =>
    row.forEach((cell) => {
      board.append(cell.html);
    }),
  );

  const undo = newUndoStack(cells);
  attachRangeGestures(board, cells, undo);
  attachAutoEliminate(cells, undo, isAutoEliminateEnabled);

  // The HUD groups the guess pips with whatever sits alongside them above the
  // board (currently just the timer, appended into this div by main.ts) so
  // they read as one chrome block with shared spacing/alignment, rather than
  // as loose siblings stacked by document order.
  const hud: HTMLDivElement = document.createElement("div");
  hud.id = "hud";

  const hudRow: HTMLDivElement = document.createElement("div");
  hudRow.id = "hud-row";
  hudRow.append(game.html);
  hud.append(hudRow);

  // Not mounted here — main.ts places it in the below-board row next to
  // "Start over", not in the HUD.
  const undoButton = newUndoButton(undo);

  // Clear undo stack at game end
  game.onEnd(() => undo.clear());

  return {
    state: cells,
    seed: resolvedSeed,
    game,
    htmlBoard: board,
    htmlHud: hud,
    undo,
    undoButton,
  };
}
