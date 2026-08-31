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
import type { Difficulty } from "../options/options";
import { computeScore } from "./score";

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
  /**
   * The computed score for this attempt (see persistence/score.ts's
   * computeScore), or null if it hasn't been (or can't yet be) computed —
   * always null while status is "playing" (scoring an unfinished attempt
   * doesn't make sense), and also null for any entry migrated up from a
   * pre-score schema (see migrateV1/migrateV2 below) rather than
   * retroactively recomputed.
   */
  score: number | null;
  /**
   * The difficulty this attempt was played under — factors into `score`
   * (see computeScore) and lets "Play again" from the history view (see
   * historyview.ts) replay a past attempt under the same difficulty it
   * originally used, rather than silently defaulting to something else.
   */
  difficulty: Difficulty;
  /** epoch ms this attempt was first recorded. */
  startedAt: number;
  /** epoch ms this entry was last written (checkpoint or final). */
  updatedAt: number;
}

interface HistoryFile {
  /** Bumped on any incompatible change to this shape, so an old history
   * store from a previous version of the app is ignored rather than misread. */
  version: 3;
  entries: HistoryEntry[];
}

const STORAGE_KEY = "colordoku:history";
const CURRENT_VERSION = 3;

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
 * Kept local/private rather than importing options.ts's exported
 * isDifficulty — see persistence.ts's isDifficultyValue for the same call
 * (avoids a value-level circular import, and matches this file's existing
 * convention of owning its own small validators, e.g. isHistoryStatus).
 */
function isDifficultyValue(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
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
    (e.score === null || typeof e.score === "number") &&
    isDifficultyValue(e.difficulty) &&
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

/**
 * The pre-score schema (version 1) — every field HistoryEntry has today
 * except `score` and `difficulty`, neither of which existed yet. Kept only
 * so loadAll() can recognize and migrate a still-around v1 store rather than
 * discarding it outright on a version bump.
 */
interface HistoryEntryV1 {
  id: string;
  size: number;
  seed: number;
  attempt: number;
  status: HistoryStatus;
  elapsedMs: number;
  startedAt: number;
  updatedAt: number;
}

interface HistoryFileV1 {
  version: 1;
  entries: HistoryEntryV1[];
}

function isHistoryEntryV1(value: unknown): value is HistoryEntryV1 {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<HistoryEntryV1>;

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

function isHistoryFileV1(value: unknown): value is HistoryFileV1 {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<HistoryFileV1>;
  if (f.version !== 1) return false;
  return Array.isArray(f.entries) && f.entries.every(isHistoryEntryV1);
}

/**
 * The pre-difficulty schema (version 2) — every field HistoryEntry has today
 * except `difficulty`, which didn't exist yet (this is exactly what v1
 * becomes after migrateV1ToV2 below, and also what a real v2 store on disk
 * looks like).
 */
interface HistoryEntryV2 extends HistoryEntryV1 {
  score: number | null;
}

interface HistoryFileV2 {
  version: 2;
  entries: HistoryEntryV2[];
}

function isHistoryEntryV2(value: unknown): value is HistoryEntryV2 {
  if (!isHistoryEntryV1(value)) return false;
  const e = value as Partial<HistoryEntryV2>;
  return e.score === null || typeof e.score === "number";
}

function isHistoryFileV2(value: unknown): value is HistoryFileV2 {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Partial<HistoryFileV2>;
  if (f.version !== 2) return false;
  return Array.isArray(f.entries) && f.entries.every(isHistoryEntryV2);
}

/**
 * Upgrades a v1 store to v2 by adding `score: null` to every entry, rather
 * than discarding pre-existing history outright on the version bump — a
 * player's past games are worth keeping even though they predate scoring.
 * Nothing is recomputed here: retroactively computing real scores for these
 * entries would need every input computeScore() takes (size, difficulty,
 * elapsedMs), and a v1 entry has no recorded difficulty at all — there's no
 * honest score to backfill, only a guess, so this leaves it null instead.
 */
function migrateV1ToV2(file: HistoryFileV1): HistoryFileV2 {
  return {
    version: 2,
    entries: file.entries.map((e) => ({ ...e, score: null })),
  };
}

/**
 * Upgrades a v2 store to v3 by defaulting `difficulty` to "medium" for every
 * entry — same reasoning and same fallback persistence.ts's migrateV1 uses
 * for SavedGame: a v2 entry predates the difficulty concept entirely, so
 * there's no real value to recover, just a reasonable default. Existing
 * `score` values (already null for anything that went through
 * migrateV1ToV2) are left exactly as they are — this migration only adds
 * `difficulty`, it doesn't touch or recompute score.
 */
function migrateV2ToV3(file: HistoryFileV2): HistoryFile {
  return {
    version: CURRENT_VERSION,
    entries: file.entries.map((e) => ({ ...e, difficulty: "medium" })),
  };
}

/** Reads the stored entries, or [] if there are none or the store is unreadable/corrupt. */
function loadAll(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (isHistoryFile(parsed)) return parsed.entries;
    if (isHistoryFileV2(parsed)) return migrateV2ToV3(parsed).entries;
    if (isHistoryFileV1(parsed)) return migrateV2ToV3(migrateV1ToV2(parsed)).entries;
    return [];
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
 * Resolves which entry (if any) is the current attempt for the given board.
 * Returns the index of the entry in the provided list, or -1 if none found.
 *
 * First checks the session cache (currentAttemptId) for speed; if that misses,
 * falls back to finding an existing entry with status "playing" matching the
 * size and seed. This fallback handles the case where a page is reloaded while
 * an attempt is mid-play (the cache is fresh on each load, but history entries
 * persist).
 */
function resolveAttemptIndex(entries: HistoryEntry[], size: number, seed: number): number {
  const key = keyFor(size, seed);
  const cachedId = currentAttemptId.get(key);
  let index = cachedId === undefined ? -1 : entries.findIndex((e) => e.id === cachedId);
  if (index === -1) {
    index = entries.findIndex(
      (e) => e.size === size && e.seed === seed && e.status === "playing",
    );
  }
  return index;
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
 *
 * `score` is optional and, when omitted on an *update* to an existing entry,
 * leaves whatever score was already stored untouched rather than nulling it
 * out — a later stray call that omits it (e.g. the same beforeunload race
 * `abandoned` guards against elsewhere in this file) must not silently erase
 * a real score already written. Omitting it on a *brand-new* entry just
 * leaves that entry scoreless (null), same as any other not-yet-scored
 * attempt.
 *
 * `difficulty` is required (unlike `score`): it's fixed for the whole
 * attempt from the moment it starts, so — unlike a score, which only exists
 * once an attempt finishes — every call, including the very first
 * "playing" checkpoint, always has a real value to write.
 */
export function recordAttempt(
  size: number,
  seed: number,
  patch: {
    status: HistoryStatus;
    elapsedMs: number;
    difficulty: Difficulty;
    score?: number | null;
  },
): void {
  if (abandoned) return;

  const entries = loadAll();
  const now = Date.now();
  const key = keyFor(size, seed);

  let index = resolveAttemptIndex(entries, size, seed);

  if (index !== -1) {
    const existing = entries[index];
    entries[index] = {
      ...existing,
      status: patch.status,
      elapsedMs: patch.elapsedMs,
      difficulty: patch.difficulty,
      score: patch.score !== undefined ? patch.score : existing.score,
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
      difficulty: patch.difficulty,
      score: patch.score ?? null,
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
    recordAttempt(saved.size, saved.seed, {
      status: "abandoned",
      elapsedMs: saved.elapsedMs,
      difficulty: saved.difficulty,
      // Abandoning always scores 0, same as a loss — computeScore() already
      // encodes that (only "won" ever earns points), so this reuses it
      // rather than hardcoding 0 a second time.
      score: computeScore(saved.size, saved.difficulty, saved.elapsedMs, "abandoned"),
    });
  }
  abandoned = true;
}

/** All stored entries, newest-started first. For a future history view. */
export function getHistory(): HistoryEntry[] {
  return loadAll()
    .slice()
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Returns the 1-indexed attempt number the next `recordAttempt()` call for
 * this (size, seed) would write. If an attempt is currently in progress on
 * this page, returns its existing attempt number (so a score computed before
 * the entry is persisted matches what was recorded). If no attempt is in
 * progress, returns (number of existing attempts for this board) + 1.
 *
 * Used in main.ts to compute a score before persisting it, ensuring the
 * score uses the correct attempt number even though the history entry hasn't
 * been written yet.
 */
export function currentAttemptNumber(size: number, seed: number): number {
  const entries = loadAll();
  const index = resolveAttemptIndex(entries, size, seed);
  if (index !== -1) return entries[index].attempt;
  return entries.filter((e) => e.size === size && e.seed === seed).length + 1;
}

/**
 * Returns the most recently updated entry for this (size, seed), or null if
 * this board has never been played. Used for scoring an already-finished
 * attempt resumed from a prior session, where currentAttemptNumber() would
 * incorrectly report the next (not-yet-started) attempt since the cache is
 * empty on a fresh page load.
 */
export function latestAttemptFor(size: number, seed: number): HistoryEntry | null {
  const matches = loadAll().filter((e) => e.size === size && e.seed === seed);
  if (matches.length === 0) return null;
  return matches.reduce((newest, e) => (e.updatedAt > newest.updatedAt ? e : newest));
}

/** Clears all stored history. Exported for tests and any future "clear my history" action. */
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See saveAll's doc comment.
  }
}
