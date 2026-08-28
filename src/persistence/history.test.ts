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
    difficulty: "medium",
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
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    const [entry] = getHistory();
    expect(entry).toMatchObject({ size: 4, seed: 111, attempt: 1, status: "playing", elapsedMs: 0 });
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);
  });

  it("updates the same entry in place on a later checkpoint for the same board (still playing)", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    recordAttempt(4, 111, { status: "playing", elapsedMs: 5000, difficulty: "medium" });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].elapsedMs).toBe(5000);
    expect(entries[0].attempt).toBe(1);
  });

  it("finalizes the entry in place when status flips to won/lost, without creating a second entry", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000, difficulty: "medium" });
    recordAttempt(4, 111, { status: "won", elapsedMs: 9000, difficulty: "medium" });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "won", elapsedMs: 9000, attempt: 1 });
  });

  it("starts a fresh entry at attempt 2 once a prior attempt on the same board is no longer 'playing', in a new session", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000, difficulty: "medium" });
    recordAttempt(4, 111, { status: "lost", elapsedMs: 8000, difficulty: "medium" }); // finalizes attempt 1
    resetSessionForTests(); // simulates a fresh page load (a real reload resets this for free)
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" }); // a fresh replay of the same board

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
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000, difficulty: "medium" });
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000, difficulty: "medium" }); // e.g. game.onEnd's persist()
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000, difficulty: "medium" }); // e.g. the bubbling click's persist(), same session

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ attempt: 1, status: "won", elapsedMs: 5000 });
  });

  it("scopes attempt numbering independently per (size, seed)", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    recordAttempt(6, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" }); // same seed, different size
    recordAttempt(4, 222, { status: "playing", elapsedMs: 0, difficulty: "medium" }); // same size, different seed

    const entries = getHistory();
    expect(entries.every((e) => e.attempt === 1)).toBe(true);
    expect(entries).toHaveLength(3);
  });

  it("tracks concurrent attempts on different boards independently", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 1000, difficulty: "medium" });
    recordAttempt(4, 222, { status: "playing", elapsedMs: 2000, difficulty: "medium" });
    recordAttempt(4, 111, { status: "won", elapsedMs: 5000, difficulty: "medium" });

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
    recordAttempt(4, 12345, { status: "won", elapsedMs: 4200, difficulty: "medium" });
    closeOutInProgress();
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("won"); // unchanged, not overwritten to "abandoned"
  });

  it("finalizes an in-progress attempt as 'abandoned', matching the saved game's size/seed/elapsedMs", () => {
    saveGame(makeSave({ gameState: 0, elapsedMs: 7777 }));
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 1000, difficulty: "medium" });

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
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 1000, difficulty: "medium" });

    closeOutInProgress(); // writes "abandoned"

    // Simulates the late beforeunload-triggered persist() call.
    recordAttempt(4, 12345, { status: "playing", elapsedMs: 9999, difficulty: "medium" });

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: "abandoned", elapsedMs: 7777 });
  });
});

describe("getHistory", () => {
  it("returns entries newest-started first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    recordAttempt(4, 1, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    vi.setSystemTime(2000);
    recordAttempt(4, 2, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    vi.setSystemTime(3000);
    recordAttempt(4, 3, { status: "playing", elapsedMs: 0, difficulty: "medium" });
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
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
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
    // version 99 here, not 2: CURRENT_VERSION is 2, so a store actually
    // stamped 2 is valid data, not an incompatible-version case — this test
    // needs a version genuinely ahead of anything this code understands.
    // Non-empty entries too, so the assertion can't pass vacuously the way
    // `{ version: 2, entries: [] }` now would (empty either way).
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({
        version: 99,
        entries: [
          { id: "a", size: 4, seed: 1, attempt: 1, status: "won", elapsedMs: 0, score: 100, difficulty: "medium", startedAt: 0, updatedAt: 0 },
        ],
      }),
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
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].attempt).toBe(1);
  });
});

describe("migrating a pre-score/pre-difficulty (v1) store", () => {
  it("reads a v1 store (no score or difficulty field at all) and adds score: null + difficulty: 'medium' to every entry", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({
        version: 1,
        entries: [
          { id: "a", size: 4, seed: 1, attempt: 1, status: "won", elapsedMs: 1234, startedAt: 10, updatedAt: 20 },
          { id: "b", size: 8, seed: 2, attempt: 1, status: "lost", elapsedMs: 5678, startedAt: 30, updatedAt: 40 },
        ],
      }),
    );

    const entries = getHistory();
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.score === null)).toBe(true);
    expect(entries.every((e) => e.difficulty === "medium")).toBe(true);
    // Nothing else about the entries is altered by the migration.
    expect(entries.find((e) => e.id === "a")).toMatchObject({
      size: 4,
      seed: 1,
      status: "won",
      elapsedMs: 1234,
    });
  });

  it("still rejects a v1 store with a genuinely malformed entry, same as before the migration existed", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({ version: 1, entries: [{ id: "a", size: 4 }] }),
    );
    expect(getHistory()).toEqual([]);
  });

  it("a v1 store is upgraded to v3 storage the next time recordAttempt() writes", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({
        version: 1,
        entries: [
          { id: "a", size: 4, seed: 1, attempt: 1, status: "won", elapsedMs: 1234, startedAt: 10, updatedAt: 20 },
        ],
      }),
    );

    recordAttempt(6, 2, { status: "playing", elapsedMs: 0, difficulty: "medium" });

    const raw = JSON.parse(localStorage.getItem("colordoku:history")!);
    expect(raw.version).toBe(3);
    expect(raw.entries).toHaveLength(2);
    expect(raw.entries.every((e: { score: unknown }) => "score" in e)).toBe(true);
    expect(raw.entries.every((e: { difficulty: unknown }) => "difficulty" in e)).toBe(true);
  });
});

describe("migrating a pre-difficulty (v2) store", () => {
  it("reads a v2 store (has score, no difficulty) and defaults difficulty to 'medium'", () => {
    localStorage.setItem(
      "colordoku:history",
      JSON.stringify({
        version: 2,
        entries: [
          { id: "a", size: 4, seed: 1, attempt: 1, status: "won", elapsedMs: 1234, score: 320, startedAt: 10, updatedAt: 20 },
        ],
      }),
    );

    const entries = getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ score: 320, difficulty: "medium" });
  });
});

describe("recordAttempt score handling", () => {
  it("defaults a brand-new entry's score to null when omitted", () => {
    recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    expect(getHistory()[0].score).toBeNull();
  });

  it("sets a new entry's score when explicitly provided", () => {
    recordAttempt(4, 111, { status: "won", elapsedMs: 1000, difficulty: "medium", score: 500 });
    expect(getHistory()[0].score).toBe(500);
  });

  it("a later update that omits score preserves whatever score was already stored, rather than nulling it out", () => {
    recordAttempt(4, 111, { status: "won", elapsedMs: 1000, difficulty: "medium", score: 500 });
    // Simulates a later stray write (e.g. a beforeunload race) that doesn't pass a score at all.
    recordAttempt(4, 111, { status: "won", elapsedMs: 1000, difficulty: "medium" });
    expect(getHistory()[0].score).toBe(500);
  });

  it("an update that explicitly passes score: null does overwrite a previously-set score", () => {
    recordAttempt(4, 111, { status: "won", elapsedMs: 1000, difficulty: "medium", score: 500 });
    recordAttempt(4, 111, { status: "won", elapsedMs: 1000, difficulty: "medium", score: null });
    expect(getHistory()[0].score).toBeNull();
  });
});

describe("storage failure handling", () => {
  it("swallows a setItem failure (e.g. quota exceeded, disabled storage)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => recordAttempt(4, 111, { status: "playing", elapsedMs: 0, difficulty: "medium" })).not.toThrow();
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
      recordAttempt(4, i, { status: "playing", elapsedMs: 0, difficulty: "medium" });
      recordAttempt(4, i, { status: "lost", elapsedMs: 0, difficulty: "medium" }); // finalize immediately, seed i
    }
    expect(getHistory()).toHaveLength(500);

    // One more finalized attempt on a brand new board should push it over
    // the cap and evict the single oldest finalized entry (seed 0).
    vi.setSystemTime(600);
    recordAttempt(4, 999, { status: "playing", elapsedMs: 0, difficulty: "medium" });
    recordAttempt(4, 999, { status: "won", elapsedMs: 0, difficulty: "medium" });

    const entries = getHistory();
    expect(entries).toHaveLength(500);
    expect(entries.some((e) => e.seed === 0)).toBe(false); // oldest evicted
    expect(entries.some((e) => e.seed === 999)).toBe(true); // newest kept

    vi.useRealTimers();
  });

  it("never evicts the in-progress ('playing') entry even if it is the oldest", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    recordAttempt(4, -1, { status: "playing", elapsedMs: 0, difficulty: "medium" }); // oldest, stays in progress

    for (let i = 0; i < 500; i++) {
      vi.setSystemTime(i + 1);
      recordAttempt(4, i, { status: "playing", elapsedMs: 0, difficulty: "medium" });
      recordAttempt(4, i, { status: "lost", elapsedMs: 0, difficulty: "medium" });
    }

    const entries = getHistory();
    expect(entries.some((e) => e.seed === -1 && e.status === "playing")).toBe(true);

    vi.useRealTimers();
  });
});
