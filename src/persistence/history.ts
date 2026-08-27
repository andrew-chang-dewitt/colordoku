/**
 * Records a history of games played — one entry per *attempt* at a board
 * (a specific size+seed, possibly played more than once) — kept around after
 * a game ends or is abandoned, for a future "your past games" view.
 *
 * This is deliberately separate from persistence.ts's SavedGame, which only
 * ever tracks the single most-recently-active game for "resume where I left
 * off" (one slot, overwritten every time). History instead accumulates
 * across attempts and across boards, and entries are meant to outlive the
 * game they describe.
 *
 * Like SavedGame, an entry stores `size`+`seed`, not a full cell-array
 * snapshot of the board: src/board/generate.ts's generateCells is a pure
 * function of (size, seed) — an explicit seed always resolves through
 * exactly one worker, so it's fully reproducible regardless of whether the
 * *original* generation raced several workers (only a fresh, seed-less
 * generation does that; see that file's doc comments) — so the layout is
 * cheaply rebuildable from two numbers instead of needing to be serialized
 * per entry, same reasoning SavedGame already relies on.
 */

import { loadGame } from "./persistence";

export type HistoryStatus = "playing" | "won" | "lost" | "abandoned";
// "playing": last-known state of a game that hasn't finished yet — not just
//   a final outcome, so this is written well before a game ends too.
// "won" / "lost": mirrors Game['state'] 1/2 once the game actually ends.
// "abandoned": reserved for an explicit-abandon / "start over" feature that
//   isn't built yet. recordAttempt() already accepts this status — that
//   future work's only job is to call recordAttempt(size, seed, { status:
//   "abandoned", elapsedMs }) for the game it's replacing before starting a
//   fresh attempt. This is the intended extension point; it should not need
//   its own write path or schema change.

export interface HistoryEntry {
  id: string;
  size: number;
  seed: number;
  /** 1-indexed count of attempts ever started on this exact (size, seed) board, including this one. */
  attempt: number;
  status: HistoryStatus;
  elapsedMs: number;
  /** epoch ms this attempt was first recorded. */
  startedAt: number;
  /** epoch ms this entry was last written (checkpoint or final). */
  updatedAt: number;
}

interface HistoryFile {
  /** Bumped on any incompatible change to this shape, so an old history
   * store from a previous version of the app is ignored rather than misread. */
  version: 1;
  entries: HistoryEntry[];
}

const STORAGE_KEY = "colordoku:history";
const CURRENT_VERSION = 1;

/**
 * Cap on total stored entries. localStorage has a real (browser-dependent,
 * typically several MB) quota, and history — unlike SavedGame's single
 * overwritten slot — only ever grows. Each entry is small (well under 200
 * bytes as JSON), so this cap is generous relative to storage limits; it
 * exists to bound pathological long-term growth (years of daily play), not
 * because normal use is expected to approach it.
 *
 * Eviction (see prune()) drops the oldest *finalized* entries first and
 * never the in-progress one. A consequence worth knowing: if a board is
 * replayed often enough, over a long enough history, for its oldest attempts
 * to fall off this cap, `attempt` numbering for that board is computed only
 * from what's still on record — it can undercount the true lifetime attempt
 * count once eviction has happened. Accepted tradeoff: a second,
 * never-pruned store just to keep attempt counts exact forever was judged
 * not worth the extra complexity for how unlikely hitting this cap is.
 */
const MAX_ENTRIES = 500;

function newId(): string {
  if (typeof crypto === "object" && crypto !== null && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. older test
  // environments) — collision odds are irrelevant here, this is a local
  // bookkeeping id, not anything security-sensitive.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Mirrors Game['state'] (0 continuing / 1 won / 2 lost) into a HistoryStatus. */
export function statusFromGameState(state: 0 | 1 | 2): HistoryStatus {
  if (state === 1) return "won";
  if (state === 2) return "lost";
  return "playing";
}

function isHistoryStatus(value: unknown): value is HistoryStatus {
  return value === "playing" || value === "won" || value === "lost" || value === "abandoned";
}

/**
 * Structural validation against schema drift or hand-edited/corrupted
 * localStorage, same rationale as persistence.ts's isSavedGame. Any single
 * malformed entry invalidates the whole stored file (rather than trying to
 * salvage the rest) — simplest safe behavior, matching that file's style.
 */
function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<HistoryEntry>;

  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.size === "number" &&
    Number.isInteger(e.size) &&
    e.size >= 1 &&
    typeof e.seed === "number" &&
    typeof e.attempt === "number" &&
    Number.isInteger(e.attempt) &&
    e.attempt >= 1 &&
    isHistoryStatus(e.status) &&
    typeof e.elapsedMs === "number" &&
    e.elapsedMs >= 0 &&
    typeof e.startedAt === "number" &&
    typeof e.updatedAt === "number"
  );
}

function isHistoryFile(value: unknown): value is HistoryFile {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<HistoryFile>;
  if (f.version !== CURRENT_VERSION) return false;
  return Array.isArray(f.entries) && f.entries.every(isHistoryEntry);
}

/** Reads the stored entries, or [] if there are none or the store is unreadable/corrupt. */
function loadAll(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return isHistoryFile(parsed) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Evicts the oldest finalized entries once over MAX_ENTRIES — see its doc comment. */
function prune(entries: HistoryEntry[]): HistoryEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;

  const playing = entries.filter((e) => e.status === "playing");
  const finalized = entries
    .filter((e) => e.status !== "playing")
    .sort((a, b) => a.startedAt - b.startedAt);

  const keepFinalized = Math.max(0, MAX_ENTRIES - playing.length);
  const kept = [...playing, ...finalized.slice(finalized.length - keepFinalized)];
  return kept.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Persists the given entry list, overwriting whatever was stored before.
 * localStorage can throw (quota exceeded, Safari private mode, storage
 * disabled) — this is a nice-to-have, never worth crashing the game over, so
 * failures are swallowed, same as persistence.ts's saveGame.
 */
function saveAll(entries: HistoryEntry[]): void {
  try {
    const withVersion: HistoryFile = { version: CURRENT_VERSION, entries };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withVersion));
  } catch {
    // See doc comment above.
  }
}

/**
 * Which entry id this page is currently writing to, per (size, seed),
 * cached in memory for this page's lifetime (reset on reload, like
 * persistence.ts's `abandoned` flag). Exists to keep multiple recordAttempt()
 * calls within one session — including two in a row for the very same game
 * end, see below — writing to the *same* entry rather than spawning a
 * duplicate the moment its status stops being "playing".
 *
 * Why that can happen: main.ts persists on every cell click (bubbling from
 * board.html) *and* from game.onEnd's callback, and a winning/losing click
 * triggers both for the same click — onEnd fires synchronously as soon as
 * cell.ts's handler calls game.incFound()/incGuess(), finalizing the entry
 * (e.g. to "won"), and then the same click event keeps bubbling up to
 * board.html's own listener, which persists again a moment later. Matching
 * purely on "the entry with status playing" would miss on that second call
 * (already "won") and wrongly start a whole new attempt. Caching the id here
 * means the second call reuses it regardless of what status the first call
 * already wrote.
 *
 * A cache miss (nothing recorded yet this page load — e.g. right after a
 * reload that resumes an in-progress game) intentionally falls back to
 * adopting an existing "playing" entry for that board, which is exactly the
 * behavior a resumed game needs: continue the same entry, not start a new one.
 */
const currentAttemptId = new Map<string, string>();

function keyFor(size: number, seed: number): string {
  return `${size}:${seed}`;
}

/**
 * Set once closeOutInProgress() has run, for the rest of this page's life —
 * mirrors persistence.ts's `abandoned` flag and closes the exact same race
 * it does: goToSize() calls closeOutInProgress() then abandonGame() then
 * navigates via location.assign, but the *old* page's own beforeunload
 * persist() handler still fires during that navigation (after this
 * synchronous code has already run) and would otherwise silently overwrite
 * the "abandoned" status just written — with a fresher elapsedMs, but back
 * to status "playing" (since board.game.state never actually changed) —
 * confirmed via manual/real-browser testing, not just theorized. Once an
 * attempt has been explicitly closed out, nothing on this page should be
 * able to write over that.
 */
let abandoned = false;

/**
 * The single write path for history: creates or updates the current attempt
 * for (size, seed). A checkpoint mid-game (status: "playing", called on the
 * same cadence persistence.ts's saveGame already is — see main.ts), the
 * final won/lost outcome, and a future explicit abandon all go through this
 * one function, just with a different `status` — see HistoryStatus's doc
 * comment for that extension point.
 *
 * Resolves which entry to write to via currentAttemptId (see its doc
 * comment) falling back to an existing "playing" entry for this exact
 * (size, seed); otherwise starts a new one, with `attempt` computed as
 * (however many entries already exist for this board) + 1.
 */
export function recordAttempt(
  size: number,
  seed: number,
  patch: { status: HistoryStatus; elapsedMs: number },
): void {
  if (abandoned) return;

  const entries = loadAll();
  const now = Date.now();
  const key = keyFor(size, seed);

  const cachedId = currentAttemptId.get(key);
  let index = cachedId === undefined ? -1 : entries.findIndex((e) => e.id === cachedId);
  if (index === -1) {
    index = entries.findIndex(
      (e) => e.size === size && e.seed === seed && e.status === "playing",
    );
  }

  if (index !== -1) {
    entries[index] = {
      ...entries[index],
      status: patch.status,
      elapsedMs: patch.elapsedMs,
      updatedAt: now,
    };
    currentAttemptId.set(key, entries[index].id);
  } else {
    const attempt = entries.filter((e) => e.size === size && e.seed === seed).length + 1;
    const id = newId();
    entries.push({
      id,
      size,
      seed,
      attempt,
      status: patch.status,
      elapsedMs: patch.elapsedMs,
      startedAt: now,
      updatedAt: now,
    });
    currentAttemptId.set(key, id);
  }

  saveAll(prune(entries));
}

/**
 * Test-only: resets the in-memory per-page-load state (the currentAttemptId
 * cache and the `abandoned` flag — see their doc comments), so a test can
 * simulate a fresh page load without actually reloading. Application code
 * never needs this: a real page gets both for free, fresh, on every load.
 */
export function resetSessionForTests(): void {
  currentAttemptId.clear();
  abandoned = false;
}

/**
 * Finalizes whatever attempt is currently in progress (if any) as
 * "abandoned", without starting a new one. Meant to be called from
 * options.ts's goToSize() — the single choke point both "start a new game"
 * paths already go through to abandon the old SavedGame — so that switching
 * to a different board/size doesn't leave a phantom "playing" history entry
 * behind for a game the player is no longer playing.
 *
 * Reads persistence.ts's SavedGame (rather than taking size/seed/elapsedMs
 * as parameters) so callers don't need to duplicate that lookup. Must be
 * called *before* abandonGame() clears it — see goToSize. A no-op if there's
 * nothing saved, or the saved game had already ended (nothing in progress to
 * abandon).
 *
 * Also permanently disables further recordAttempt() calls on this page after
 * writing the abandon record — see the `abandoned` flag's doc comment for
 * the beforeunload race that closes. The write happens first, since setting
 * the flag first would make recordAttempt() below a no-op too.
 */
export function closeOutInProgress(): void {
  const saved = loadGame();
  if (saved !== null && saved.gameState === 0) {
    recordAttempt(saved.size, saved.seed, { status: "abandoned", elapsedMs: saved.elapsedMs });
  }
  abandoned = true;
}

/** All stored entries, newest-started first. For a future history view. */
export function getHistory(): HistoryEntry[] {
  return loadAll()
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Clears all stored history. Exported for tests and any future "clear my history" action. */
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveAll's doc comment.
  }
}
