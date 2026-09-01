import type { Cell } from "../cell/cell";

/**
 * One cell's pre-change mark state, as recorded by the undo stack. Only ever
 * 0 (unmarked) or 1 (eliminated): a committed guess — right or wrong — is
 * never recorded (see this module's doc comment), so state 2 (queen) can
 * never appear here.
 */
export interface UndoMark {
  row: number;
  col: number;
  previous: 0 | 1;
}

export interface UndoStack {
  canUndo: () => boolean;
  depth: () => number;
  begin: () => void;
  end: () => void;
  undo: () => boolean;
  clear: () => void;
  onChange: (cb: (canUndo: boolean) => void) => void;
  onApply: (cb: () => void) => void;
}

/**
 * A session-only, in-memory undo stack for elimination marks.
 *
 * Deliberately narrow: it can undo *only* free mark toggles (0 <-> 1) on
 * non-frozen cells — a single click, keyboard X, or any of board.ts's
 * multi-cell marking gestures. It can never undo a committed guess, whether
 * that guess placed a queen or was wrong: cell.ts's commitGuess() sets state
 * directly (never through mark()/toggle()), so nothing about a commit is ever
 * recorded, and the moment a cell freezes, forget() drops every entry that
 * referenced it — so a mark made as the first half of a double-click can't be
 * left behind as a dead "undo" that would do nothing.
 *
 * Never persisted: persistence.ts's SavedGame has no undo data, so a reload
 * starts with an empty stack.
 */
export function newUndoStack(cells: Cell[][]): UndoStack {
  const stack: UndoMark[][] = [];
  let open: Map<string, UndoMark> | null = null;
  let applying = false;

  const changeListeners: Array<(canUndo: boolean) => void> = [];
  const applyListeners: Array<() => void> = [];

  const key = (row: number, col: number): string => `${row},${col}`;

  function notifyChange(): void {
    for (const cb of changeListeners) cb(stack.length > 0);
  }

  function record(row: number, col: number, previous: 0 | 1): void {
    if (applying) return;
    if (open !== null) {
      const k = key(row, col);
      if (!open.has(k)) open.set(k, { row, col, previous });
      return;
    }
    stack.push([{ row, col, previous }]);
    notifyChange();
  }

  function forget(row: number, col: number): void {
    const k = key(row, col);
    if (open !== null) open.delete(k);
    for (let i = stack.length - 1; i >= 0; i--) {
      const kept = stack[i].filter((m) => key(m.row, m.col) !== k);
      if (kept.length === 0) stack.splice(i, 1);
      else stack[i] = kept;
    }
    notifyChange();
  }

  cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      cell.onMark = (previous) => record(r, c, previous);
      cell.onFreeze = () => forget(r, c);
    }),
  );

  return {
    canUndo: () => stack.length > 0,
    depth: () => stack.length,

    begin() {
      if (open !== null) this.end();
      open = new Map();
    },

    end() {
      if (open === null) return;
      const entry = [...open.values()];
      open = null;
      if (entry.length === 0) return;
      stack.push(entry);
      notifyChange();
    },

    undo() {
      if (stack.length === 0) return false;
      const entry = stack.pop()!;
      applying = true;
      try {
        for (const { row, col, previous } of entry) {
          const cell = cells[row][col];
          if (!cell.frozen) cell.mark(previous);
        }
      } finally {
        applying = false;
      }
      notifyChange();
      for (const cb of applyListeners) cb();
      return true;
    },

    clear() {
      stack.length = 0;
      open = null;
      notifyChange();
    },

    onChange(cb) {
      changeListeners.push(cb);
    },

    onApply(cb) {
      applyListeners.push(cb);
    },
  };
}

/**
 * The HUD's "Undo" button. Disabled whenever there is nothing to undo —
 * including at game end, when board.ts clears the stack.
 */
export function newUndoButton(undo: UndoStack): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "undo";
  button.className = "btn btn-secondary";
  button.title = "Undo last mark (Ctrl+Z / U)";
  button.setAttribute("aria-label", "Undo last elimination mark");
  button.disabled = !undo.canUndo();

  // A plain counter-clockwise arrow — icon-only, no label text, since the
  // aria-label/title already carry the meaning for screen readers/hover.
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>' +
    "</svg>";

  button.addEventListener("click", () => {
    undo.undo();
  });

  undo.onChange((canUndo) => {
    button.disabled = !canUndo;
  });

  return button;
}
