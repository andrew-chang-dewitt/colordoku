/**
 * Tracks the tutorial's lifecycle: whether it has been seen, how far the player
 * got, and whether they completed it. Uses localStorage with a fixed key
 * (`colordoku:tutorial`), versioned schema, and structural validation — same
 * idiom as persistence.ts / history.ts / pregen.ts.
 *
 * Absence of the key means "unseen" (no stored record at all) — there is no
 * separate `"unseen"` status. This is by design: it reduces storage overhead
 * and keeps the first-time detection trivial (`hasSeenTutorial()` returns
 * `!record` or `record.status !== ...`, both cheap).
 *
 * `completedAt` is latched: once it's set (the tutorial is finished for the
 * first time), a later replay that is skipped must not clear it. This supports
 * a score bonus keyed to the very first completion.
 */

const STORAGE_KEY = "colordoku:tutorial";
const CURRENT_VERSION = 1;

/**
 * Sentinel seed for the tutorial completion bonus entry. Entries with this
 * seed are not "real" boards but virtual history entries representing the
 * one-time completion bonus.
 */
export const TUTORIAL_SEED = 0xffffffff; // Max uint32, unlikely to collide with real seeds
export const TUTORIAL_BONUS = 100; // Fixed bonus points for first-time completion

export type TutorialStatus = "started" | "skipped" | "completed";

export interface TutorialRecord {
  version: 1;
  status: TutorialStatus;
  /** Furthest 0-indexed step reached; for diagnostics, not resume. */
  step: number;
  /** epoch ms of the last write. */
  updatedAt: number;
  /** epoch ms the player first finished it; null until then. Latched — a later
   *  replay that is skipped must not clear it. */
  completedAt: number | null;
}

/**
 * Returns the tutorial record, or null if there isn't one or it's
 * unreadable/corrupt. Absence of the key == unseen (no record at all).
 */
export function loadTutorial(): TutorialRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isTutorialRecord(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * No stored record at all == a brand-new player who hasn't seen the tutorial.
 * This is true even on the second visit if the first visit skipped it
 * (though they won't be auto-shown again — it only fires on first-run when
 * `saved === null`).
 */
export function hasSeenTutorial(): boolean {
  const record = loadTutorial();
  return record !== null && record.status !== undefined;
}

/**
 * Records that the player has opened the tutorial. This fires immediately so a
 * reload *during* the tutorial doesn't ambush the player with it again.
 */
export function markTutorialStarted(): void {
  try {
    const record = loadTutorial() ?? {
      version: CURRENT_VERSION,
      completedAt: null,
    };
    const updated: TutorialRecord = {
      ...record,
      version: CURRENT_VERSION,
      status: "started",
      step: 0,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw — this is a nice-to-have, never worth crashing over.
  }
}

/**
 * Records progress through the tutorial: which step the player reached.
 * Called on every step transition.
 */
export function markTutorialProgress(step: number): void {
  try {
    const record = loadTutorial() ?? {
      version: CURRENT_VERSION,
      completedAt: null,
    };
    const updated: TutorialRecord = {
      ...record,
      version: CURRENT_VERSION,
      status: "started",
      step,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw — this is a nice-to-have, never worth crashing over.
  }
}

/**
 * Records that the player skipped the tutorial. Does NOT clear `completedAt`,
 * so a first-time completion followed by a replay skip still shows a latched
 * completion timestamp for score-bonus purposes.
 */
export function markTutorialSkipped(step: number): void {
  try {
    const record = loadTutorial() ?? {
      version: CURRENT_VERSION,
      completedAt: null,
    };
    const updated: TutorialRecord = {
      ...record,
      version: CURRENT_VERSION,
      status: "skipped",
      step,
      updatedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw — this is a nice-to-have, never worth crashing over.
  }
}

/**
 * Records that the player completed the tutorial. Sets `completedAt` only if
 * it is currently null (the very first completion), so a later replay never
 * clears that timestamp. Useful for a score bonus that should fire only once.
 */
export function markTutorialCompleted(step: number): void {
  try {
    const record = loadTutorial() ?? {
      version: CURRENT_VERSION,
      completedAt: null,
    };
    const updated: TutorialRecord = {
      ...record,
      version: CURRENT_VERSION,
      status: "completed",
      step,
      updatedAt: Date.now(),
      completedAt: record.completedAt ?? Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage can throw — this is a nice-to-have, never worth crashing over.
  }
}

/**
 * Low-level clear: removes the stored record. Exported mainly for tests.
 */
export function clearTutorial(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage can throw — this is a nice-to-have, never worth crashing over.
  }
}

/**
 * Structural validation against schema drift, hand-edited localStorage, or
 * corrupt JSON — this is user-controlled input, so nothing is trusted without
 * a shape check.
 */
function isTutorialRecord(value: unknown): value is TutorialRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<TutorialRecord>;

  if (v.version !== CURRENT_VERSION) return false;
  if (v.status !== "started" && v.status !== "skipped" && v.status !== "completed") {
    return false;
  }
  if (typeof v.step !== "number" || !Number.isInteger(v.step) || v.step < 0) {
    return false;
  }
  if (typeof v.updatedAt !== "number" || v.updatedAt < 0) return false;
  if (v.completedAt !== null && (typeof v.completedAt !== "number" || v.completedAt < 0)) {
    return false;
  }

  return true;
}
