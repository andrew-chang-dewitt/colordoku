/**
 * Saves/restores in-progress game state across a reload (or navigating away
 * and back), using localStorage — there's no backend or accounts, so it's
 * the obvious place for this. Only the most recently active game is tracked,
 * under a single fixed key: this is a "resume where I left off" feature, not
 * a save-slot system, and multiple concurrent games aren't a real use case
 * for a single-player puzzle with no accounts. Changing board size (via the
 * options drawer or "New game, same size") discards whatever was saved —
 * see clearGame()'s call site in src/options/options.ts's goToSize.
 *
 * What's stored is `size` + `seed`, not the full region/queen grid: the wasm
 * generator is a pure function of (size, seed) — see src/board/generate.ts's
 * `generateCells` — so the layout is cheaply reproducible instead of needing
 * to be serialized. Only player progress (each cell's state/frozen, guesses,
 * elapsed time, win/loss) is actually saved.
 */

type CellState = 0 | 1 | 2; // not marked, eliminated, queen — mirrors cell.ts's State

export interface SavedCell {
  state: CellState;
  frozen: boolean;
}

export interface SavedGame {
  /** Bumped on any incompatible change to this shape, so an old save from a
   * previous version of the app is ignored rather than misread. */
  version: 1;
  size: number;
  seed: number;
  guessesLeft: number;
  queensFound: number;
  /** Mirrors Game['state']: 0 continuing, 1 won, 2 lost. */
  gameState: 0 | 1 | 2;
  elapsedMs: number;
  /** Row-major, same shape as Board['state']. */
  cells: SavedCell[][];
}

const STORAGE_KEY = "colordoku:save";
const CURRENT_VERSION = 1;

/**
 * Set once abandonGame() has been called, for the rest of this page's life.
 * Exists to close a real race: main.ts persists on `beforeunload` (so idle
 * elapsed time isn't lost on a normal close/reload) as well as on every cell
 * interaction. But "start a new game at this size" also navigates via
 * location.assign — and that navigation's own `beforeunload` fires *after*
 * the synchronous code that requested it (including any clearGame() call)
 * has already run, on the very page whose board is being abandoned. Without
 * this latch, that late beforeunload's persist() call would silently
 * resurrect the just-cleared save, and the "new" game would load right back
 * into the old one. Once the player has explicitly abandoned a game, nothing
 * on this page should be able to save another one over it.
 */
let abandoned = false;

/**
 * Persists the given snapshot, overwriting whatever was saved before.
 * A no-op after abandonGame() has been called (see the flag's doc comment).
 * localStorage can also throw (quota exceeded, Safari private mode, storage
 * disabled by the user/browser) — this is a nice-to-have, never worth
 * crashing the game over, so failures are swallowed too.
 */
export function saveGame(data: Omit<SavedGame, "version">): void {
  if (abandoned) return;
  try {
    const withVersion: SavedGame = { ...data, version: CURRENT_VERSION };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withVersion));
  } catch {
    // See doc comment above.
  }
}

/** Returns the saved game, or null if there isn't one or it's unreadable/corrupt. */
export function loadGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedGame(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Low-level clear: removes whatever is saved, but does NOT stop a later
 * saveGame() call on this page from writing a new one. Exported mainly for
 * tests and any caller that genuinely just wants storage wiped. Application
 * code choosing to start a new game should use abandonGame() instead — see
 * its doc comment for why a plain clear isn't enough there.
 */
export function clearGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveGame's doc comment.
  }
}

/**
 * Clears the saved game and permanently disables further saves for the rest
 * of this page's life. This is what "start a new game" (options.ts's
 * goToSize, which navigates away right after calling this) should call —
 * see the `abandoned` flag's doc comment for the beforeunload race this
 * closes that a plain clearGame() doesn't.
 */
export function abandonGame(): void {
  abandoned = true;
  clearGame();
}

function isCellState(value: unknown): value is CellState {
  return value === 0 || value === 1 || value === 2;
}

function isSavedCell(value: unknown): value is SavedCell {
  return (
    typeof value === "object" &&
    value !== null &&
    isCellState((value as SavedCell).state) &&
    typeof (value as SavedCell).frozen === "boolean"
  );
}

/**
 * Structural validation against schema drift or hand-edited/corrupted
 * localStorage — this is user-controlled input from the browser's
 * perspective, so nothing here is trusted without a shape check. Also cross
 * -checks `cells` is exactly `size` x `size`, since a mismatch there would
 * otherwise blow up later when restoring against a freshly generated board.
 */
function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<SavedGame>;

  if (v.version !== CURRENT_VERSION) return false;
  if (typeof v.size !== "number" || !Number.isInteger(v.size) || v.size < 1) {
    return false;
  }
  if (typeof v.seed !== "number") return false;
  if (typeof v.guessesLeft !== "number" || v.guessesLeft < 0) return false;
  if (typeof v.queensFound !== "number" || v.queensFound < 0) return false;
  if (v.gameState !== 0 && v.gameState !== 1 && v.gameState !== 2) return false;
  if (typeof v.elapsedMs !== "number" || v.elapsedMs < 0) return false;

  if (!Array.isArray(v.cells) || v.cells.length !== v.size) return false;
  for (const row of v.cells) {
    if (!Array.isArray(row) || row.length !== v.size) return false;
    if (!row.every(isSavedCell)) return false;
  }

  return true;
}
