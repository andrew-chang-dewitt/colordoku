import { beforeEach, describe, expect, it, vi } from "vitest";
import { abandonGame, clearGame, loadGame, saveGame, type SavedGame } from "./persistence";

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
});

describe("saveGame / loadGame round-trip", () => {
  it("returns exactly what was saved, plus the version stamp", () => {
    const data = makeSave();
    saveGame(data);
    expect(loadGame()).toEqual({ ...data, version: 2 });
  });

  it("returns null when nothing has been saved", () => {
    expect(loadGame()).toBeNull();
  });

  it("overwrites any previous save (single-slot, most-recent-game only)", () => {
    saveGame(makeSave({ elapsedMs: 1000 }));
    saveGame(makeSave({ elapsedMs: 9000 }));
    expect(loadGame()?.elapsedMs).toBe(9000);
  });
});

describe("clearGame", () => {
  it("removes a saved game", () => {
    saveGame(makeSave());
    clearGame();
    expect(loadGame()).toBeNull();
  });

  it("is a no-op when nothing was saved", () => {
    expect(() => clearGame()).not.toThrow();
    expect(loadGame()).toBeNull();
  });
});

describe("resilience to bad/corrupt data", () => {
  it("ignores non-JSON garbage in the storage slot", () => {
    localStorage.setItem("colordoku:save", "not json{{{");
    expect(loadGame()).toBeNull();
  });

  it("ignores a save from an incompatible/future schema version", () => {
    // version 99, not 2: CURRENT_VERSION is 2 now, so a save actually
    // stamped 2 is valid data, not an incompatible-version case.
    localStorage.setItem(
      "colordoku:save",
      JSON.stringify({ ...makeSave(), version: 99 }),
    );
    expect(loadGame()).toBeNull();
  });

  it("ignores a save whose cells grid doesn't match its own size", () => {
    const bad = { ...makeSave(), version: 1, cells: [[{ state: 0, frozen: false }]] };
    localStorage.setItem("colordoku:save", JSON.stringify(bad));
    expect(loadGame()).toBeNull();
  });

  it("ignores a save missing required fields", () => {
    localStorage.setItem("colordoku:save", JSON.stringify({ version: 1, size: 4 }));
    expect(loadGame()).toBeNull();
  });

  it("ignores a save with an out-of-range cell state", () => {
    const bad = makeSave();
    bad.cells[0][0] = { state: 9 as never, frozen: false };
    localStorage.setItem("colordoku:save", JSON.stringify({ ...bad, version: 1 }));
    expect(loadGame()).toBeNull();
  });
});

describe("migrating a pre-difficulty (v1) save", () => {
  it("reads a v1 save (no difficulty field at all) and defaults difficulty to 'medium'", () => {
    const v1 = { ...makeSave(), version: 1 } as Record<string, unknown>;
    delete v1.difficulty;
    localStorage.setItem("colordoku:save", JSON.stringify(v1));

    const loaded = loadGame();
    expect(loaded?.difficulty).toBe("medium");
    // Nothing else about the save is altered by the migration.
    expect(loaded).toMatchObject({ size: 4, seed: 12345, elapsedMs: 4200 });
  });

  it("still rejects a v1 save with a genuinely malformed shape, same as before the migration existed", () => {
    localStorage.setItem("colordoku:save", JSON.stringify({ version: 1, size: 4 }));
    expect(loadGame()).toBeNull();
  });

  it("a v1 save is upgraded to v2 storage the next time saveGame() writes", () => {
    const v1 = { ...makeSave(), version: 1 } as Record<string, unknown>;
    delete v1.difficulty;
    localStorage.setItem("colordoku:save", JSON.stringify(v1));

    saveGame(makeSave({ elapsedMs: 999 }));

    const raw = JSON.parse(localStorage.getItem("colordoku:save")!);
    expect(raw.version).toBe(2);
    expect(raw.difficulty).toBe("medium");
  });
});

describe("saveGame / loadGame do not throw when storage is unavailable", () => {
  it("swallows a setItem failure (e.g. quota exceeded, disabled storage)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => saveGame(makeSave())).not.toThrow();
    spy.mockRestore();
  });

  it("swallows a getItem failure and reports no saved game", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadGame()).toBeNull();
    spy.mockRestore();
  });
});

// abandonGame() flips a permanent, page-lifetime module flag (see its doc
// comment in persistence.ts for the beforeunload race it closes), so once
// called, saveGame() is disabled for every later test in this file too.
// Keep this describe block last for that reason.
describe("abandonGame", () => {
  it("clears any saved game, like clearGame", () => {
    saveGame(makeSave());
    abandonGame();
    expect(loadGame()).toBeNull();
  });

  it("disables further saves for the rest of the page's life — the fix for " +
    "the 'New game with the same size restores the old game' bug: a late " +
    "beforeunload persist() from the page being navigated away from must " +
    "not resurrect the save this call just cleared", () => {
    abandonGame();
    saveGame(makeSave()); // simulates a late beforeunload-triggered persist()
    expect(loadGame()).toBeNull();
  });
});
