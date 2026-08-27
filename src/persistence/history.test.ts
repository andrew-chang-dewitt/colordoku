import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveGame } from "./persistence";
import type { SavedGame } from "./persistence";
import {
  clearHistory,
  closeOutInProgress,
  getHistory,
  recordAttempt,
  resetSessionForTests,
  statusFromGameState,
} from "./history";

function makeSave(overrides: Partial<Omit<SavedGame, "version">> = {}): Omit<SavedGame, "version"> {
  return {
    size: 4,
    seed: 12345,
    guessesLeft: 2,
    queensFound: 1,
    gameState: 0,
    elapsedMs: 4200,
    cells: [
      [{ state: 0, frozen: false }, { state: 1, frozen: true }, { state: 0, frozen: false }, { state: 0, frozen: false }],
      [{ state: 0, frozen: false }, { state: 0, frozen: false }, { state: 2, frozen: true }, { state: 0, frozen: false }],
      [{ state: 0, frozen: false }, { state: 0, frozen: false }, { state: 0, frozen: false }, { state: 0, frozen: false }],
      [{ state: 0, frozen: false }, { state: 0, frozen: false }, { state: 0, frozen: false }, { state: 0, frozen: false }],
    ],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetSessionForTests();
});

describe("statusFromGameState", () => {
  it("maps 0/1/2 to playing/won/lost", () => {
    expect(statusFromGameState(0)).toBe("playing");
    expect(statusFromGameState(1)).toBe("won");
    expect(statusFromGameState(2)).toBe("lost");
  });
});

describe("recordAttempt", () => {
  it("creates a new entry with attempt 1 for a board never seen before", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 });
    const [entry] = getHistory();
    expect(entry).toMatchObject({ size: 4, seed: 111, attempt: 1, status: "playing", elapsedMs: 0 });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("updates the same entry in place on a later checkpoint for the same board (still playing)", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 });
    recordAttempt(4, 111, { status: "playing", elapsedMs: 5000 });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].elapsedMs).toBe(5000);
    expect(entries[0].attempt).toBe(1);
  });

  it("finalizes the entry in place when status flips to won/lost, without creating a second entry", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000 });
    recordAttempt(4, 111, { status: "won", elapsedMs: 9000 });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "won", elapsedMs: 9000, attempt: 1 });
  });

  it("starts a fresh entry at attempt 2 once a prior attempt on the same board is no longer 'playing', in a new session", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000 });
    recordAttempt(4, 111, { status: "lost", elapsedMs: 8000 }); // finalizes attempt 1
    resetSessionForTests(); // simulates a fresh page load (a real reload resets this for free)
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 }); // a fresh replay of the same board

    const entries = getHistory().sort((a, b) => a.attempt - b.attempt);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ attempt: 1, status: "lost" });
    expect(entries[1]).toMatchObject({ attempt: 2, status: "playing" });
  });

  it("regression: a second call in the SAME session after the entry is already finalized updates it in place, rather than spawning a duplicate attempt", () => {
    // Reproduces a real bug found via manual/e2e testing: main.ts calls
    // persist() twice for the very same winning/losing click (once from
    // game.onEnd's synchronous callback, once again as the click event
    // keeps bubbling to board.html's own click listener) — see
    // currentAttemptId's doc comment in history.ts. Without the session
    // cache, the second call would find no "playing" entry left to match
    // (the first call already finalized it) and wrongly create attempt 2.
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000 });
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000 }); // e.g. game.onEnd's persist()
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000 }); // e.g. the bubbling click's persist(), same session

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ attempt: 1, status: "won", elapsedMs: 5000 });
  });

  it("scopes attempt numbering independently per (size, seed)", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 });
    recordAttempt(6, 111, { status: "playing", elapsedMs: 0 }); // same seed, different size
    recordAttempt(4, 222, { status: "playing", elapsedMs: 0 }); // same size, different seed

    const entries = getHistory();
    expect(entries.every((e) => e.attempt === 1)).toBe(true);
    expect(entries).toHaveLength(3);
  });

  it("tracks concurrent attempts on different boards independently", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000 });
    recordAttempt(4, 222, { status: "playing", elapsedMs: 2000 });
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000 });

    const entries = getHistory();
    const a = entries.find((e) => e.seed === 111);
    const b = entries.find((e) => e.seed === 222);
    expect(a).toMatchObject({ status: "won", elapsedMs: 5000 });
    expect(b).toMatchObject({ status: "playing", elapsedMs: 2000 });
  });
});

describe("closeOutInProgress", () => {
  it("is a no-op when nothing is saved", () => {
    expect(() => closeOutInProgress()).not.toThrow();
    expect(getHistory()).toHaveLength(0);
  });

  it("is a no-op when the saved game already ended (nothing in progress to abandon)", () => {
    saveGame(makeSave({ gameState: 1 }));
    recordAttempt(4, 12345, { status: "won", elapsedMs: 4200 });
    closeOutInProgress();
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("won"); // unchanged, not overwritten to "abandoned"
  });

  it("finalizes an in-progress attempt as 'abandoned', matching the saved game's size/seed/elapsedMs", () => {
    saveGame(makeSave({ gameState: 0, elapsedMs: 7777 }));
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 1000 });

    closeOutInProgress();

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "abandoned", elapsedMs: 7777, size: 4, seed: 12345 });
  });

  it("does not create a new entry if none was in progress in history yet (starts one as abandoned)", () => {
    // A saved game can exist without history having caught up yet (e.g. a
    // very first persist() this session hasn't happened before goToSize is
    // called) — closeOutInProgress should still record it, not silently drop it.
    saveGame(makeSave({ gameState: 0 }));
    closeOutInProgress();
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("abandoned");
  });

  it("regression: a later recordAttempt() call on the same page is a no-op after closeOutInProgress, so a late beforeunload persist() can't overwrite 'abandoned' back to 'playing'", () => {
    // Reproduces a real race found via manual/real-browser testing: goToSize
    // (options.ts) calls closeOutInProgress() then abandonGame() then
    // navigates via location.assign — but the *old* page's own beforeunload
    // persist() handler still fires during that navigation, after this
    // synchronous code has already run, and calls recordAttempt() one more
    // time with the game's live (never-changed) state 0 → "playing". Without
    // a guard, that silently clobbers the "abandoned" status this test's
    // closeOutInProgress() call just wrote.
    saveGame(makeSave({ gameState: 0, elapsedMs: 7777 }));
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 1000 });

    closeOutInProgress(); // writes "abandoned"

    // Simulates the late beforeunload-triggered persist() call.
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 9999 });

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "abandoned", elapsedMs: 7777 });
  });
});

describe("getHistory", () => {
  it("returns entries newest-started first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    recordAttempt(4, 1, { status: "playing", elapsedMs: 0 });
    vi.setSystemTime(2000);
    recordAttempt(4, 2, { status: "playing", elapsedMs: 0 });
    vi.setSystemTime(3000);
    recordAttempt(4, 3, { status: "playing", elapsedMs: 0 });
    vi.useRealTimers();

    const entries = getHistory();
    expect(entries.map((e) => e.seed)).toEqual([3, 2, 1]);
  });

  it("returns an empty array when nothing has been recorded", () => {
    expect(getHistory()).toEqual([]);
  });
});

describe("clearHistory", () => {
  it("removes all stored entries", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 });
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it("is a no-op when nothing was stored", () => {
    expect(() => clearHistory()).not.toThrow();
  });
});

describe("resilience to bad/corrupt data", () => {
  it("ignores non-JSON garbage in the storage slot", () => {
    localStorage.setItem("colordoku:history", "not json{{{");
    expect(getHistory()).toEqual([]);
  });

  it("ignores a store from an incompatible/future schema version", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({ version: 2, entries: [] }),
    );
    expect(getHistory()).toEqual([]);
  });

  it("ignores a store whose entries have an out-of-range status", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({
        version: 1,
        entries: [
          { id: "a", size: 4, seed: 1, attempt: 1, status: "bogus", elapsedMs: 0, startedAt: 0, updatedAt: 0 },
        ],
      }),
    );
    expect(getHistory()).toEqual([]);
  });

  it("ignores a store with a malformed entry (missing fields)", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({ version: 1, entries: [{ id: "a", size: 4 }] }),
    );
    expect(getHistory()).toEqual([]);
  });

  it("recovers by starting a fresh store once a new recordAttempt is made over corrupt data", () => {
    localStorage.setItem("colordoku:history", "not json{{{");
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0 });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].attempt).toBe(1);
  });
});

describe("storage failure handling", () => {
  it("swallows a setItem failure (e.g. quota exceeded, disabled storage)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => recordAttempt(4, 111, { status: "playing", elapsedMs: 0 })).not.toThrow();
    spy.mockRestore();
  });

  it("swallows a getItem failure and reports no history", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(getHistory()).toEqual([]);
    spy.mockRestore();
  });
});

describe("retention cap (MAX_ENTRIES = 500)", () => {
  it("evicts the oldest finalized entries once over the cap, keeping the total bounded", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    for (let i = 0; i < 500; i++) {
      vi.setSystemTime(i);
      recordAttempt(4, i, { status: "playing", elapsedMs: 0 });
      recordAttempt(4, i, { status: "lost", elapsedMs: 0 }); // finalize immediately, seed i
    }
    expect(getHistory()).toHaveLength(500);

    // One more finalized attempt on a brand new board should push it over
    // the cap and evict the single oldest finalized entry (seed 0).
    vi.setSystemTime(600);
    recordAttempt(4, 999, { status: "playing", elapsedMs: 0 });
    recordAttempt(4, 999, { status: "won", elapsedMs: 0 });

    const entries = getHistory();
    expect(entries).toHaveLength(500);
    expect(entries.some((e) => e.seed === 0)).toBe(false); // oldest evicted
    expect(entries.some((e) => e.seed === 999)).toBe(true); // newest kept

    vi.useRealTimers();
  });

  it("never evicts the in-progress ('playing') entry even if it is the oldest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    recordAttempt(4, -1, { status: "playing", elapsedMs: 0 }); // oldest, stays in progress

    for (let i = 0; i < 500; i++) {
      vi.setSystemTime(i + 1);
      recordAttempt(4, i, { status: "playing", elapsedMs: 0 });
      recordAttempt(4, i, { status: "lost", elapsedMs: 0 });
    }

    const entries = getHistory();
    expect(entries.some((e) => e.seed === -1 && e.status === "playing")).toBe(true);

    vi.useRealTimers();
  });
});
