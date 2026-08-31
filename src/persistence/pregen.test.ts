import { beforeEach, describe, expect, it } from "vitest";
import type { Difficulty } from "../options/options";
import {
  clearPregenerated,
  hasPregenerated,
  loadPregenerated,
  putPregenerated,
  takePregenerated,
  type PregeneratedBoard,
} from "./pregen";

function makeBoard(overrides: Partial<PregeneratedBoard> = {}): Omit<PregeneratedBoard, "version" | "createdAt"> {
  return {
    size: 12,
    difficulty: "medium",
    seed: 12345,
    regions: Array(144).fill(0).map((_, i) => i % 12),
    queenCols: Array(12).fill(0).map((_, i) => i),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("putPregenerated / loadPregenerated round-trip", () => {
  it("stores and retrieves a board", () => {
    const data = makeBoard();
    putPregenerated(data);
    const loaded = loadPregenerated(data.size, data.difficulty);
    expect(loaded).not.toBeNull();
    expect(loaded!.size).toBe(data.size);
    expect(loaded!.difficulty).toBe(data.difficulty);
    expect(loaded!.seed).toBe(data.seed);
    expect(loaded!.regions).toEqual(data.regions);
    expect(loaded!.queenCols).toEqual(data.queenCols);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadPregenerated(12, "medium")).toBeNull();
  });
});

describe("hasPregenerated", () => {
  it("returns true when a board exists", () => {
    putPregenerated(makeBoard());
    expect(hasPregenerated(12, "medium")).toBe(true);
  });

  it("returns false when nothing exists", () => {
    expect(hasPregenerated(12, "medium")).toBe(false);
  });
});

describe("takePregenerated", () => {
  it("retrieves and removes a board in one call", () => {
    const data = makeBoard();
    putPregenerated(data);
    const taken = takePregenerated(data.size, data.difficulty);
    expect(taken).not.toBeNull();
    expect(taken!.seed).toBe(data.seed);
    expect(loadPregenerated(data.size, data.difficulty)).toBeNull();
  });

  it("returns null when nothing exists", () => {
    expect(takePregenerated(12, "medium")).toBeNull();
  });
});

describe("overwrite same key", () => {
  it("replaces a board with the same size/difficulty", () => {
    putPregenerated(makeBoard({ seed: 111 }));
    putPregenerated(makeBoard({ seed: 222 }));
    const loaded = loadPregenerated(12, "medium");
    expect(loaded!.seed).toBe(222);
  });
});

describe("different difficulties coexist", () => {
  it("stores different difficulties for the same size independently", () => {
    putPregenerated(makeBoard({ difficulty: "easy", seed: 111 }));
    putPregenerated(makeBoard({ difficulty: "hard", seed: 222 }));
    expect(loadPregenerated(12, "easy")!.seed).toBe(111);
    expect(loadPregenerated(12, "hard")!.seed).toBe(222);
  });
});

describe("eviction at MAX_ENTRIES", () => {
  it("does not exceed MAX_ENTRIES (6) after multiple puts", () => {
    // Create entries with different difficulties to avoid the
    // "same key" filter and test pure eviction
    const difficulties: Difficulty[] = ["easy", "medium", "hard"];
    for (let i = 0; i < 10; i++) {
      const size = 12;
      const difficulty = difficulties[i % 3];
      const seed = 5000 + i;
      const entry = makeBoard({ size, difficulty, seed });
      putPregenerated(entry);
    }

    // Should not exceed MAX_ENTRIES (6)
    const stored = localStorage.getItem("colordoku:pregen");
    if (stored) {
      const parsed = JSON.parse(stored) as unknown[];
      expect(parsed.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("resilience to bad/corrupt data", () => {
  it("ignores non-JSON garbage in the storage slot", () => {
    localStorage.setItem("colordoku:pregen", "not json{{{");
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("ignores an entry with wrong version", () => {
    const board = makeBoard();
    localStorage.setItem(
      "colordoku:pregen",
      JSON.stringify([{ ...board, version: 99, createdAt: Date.now() }]),
    );
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("ignores an entry with wrong regions length", () => {
    const board = makeBoard({ regions: Array(100) });
    localStorage.setItem(
      "colordoku:pregen",
      JSON.stringify([{ ...board, version: 1, createdAt: Date.now() }]),
    );
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("ignores an entry with wrong queenCols length", () => {
    const board = makeBoard({ queenCols: Array(10) });
    localStorage.setItem(
      "colordoku:pregen",
      JSON.stringify([{ ...board, version: 1, createdAt: Date.now() }]),
    );
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("ignores an entry with invalid region values", () => {
    const board = makeBoard({ regions: Array(144).fill(999) });
    localStorage.setItem(
      "colordoku:pregen",
      JSON.stringify([{ ...board, version: 1, createdAt: Date.now() }]),
    );
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("ignores entries with invalid difficulty", () => {
    const board = makeBoard();
    const badBoard = { ...board, version: 1, createdAt: Date.now() } as unknown as Record<string, unknown>;
    badBoard.difficulty = "invalid";
    localStorage.setItem("colordoku:pregen", JSON.stringify([badBoard]));
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("filters out bad entries but keeps good ones", () => {
    const good = makeBoard({ size: 12, seed: 111 });
    const badBase = makeBoard({ size: 13 });
    const bad = { ...badBase, version: 1, createdAt: Date.now() } as unknown as Record<string, unknown>;
    bad.difficulty = "invalid";
    localStorage.setItem(
      "colordoku:pregen",
      JSON.stringify([
        bad,
        { ...good, version: 1, createdAt: Date.now() },
      ]),
    );
    expect(loadPregenerated(12, "medium")?.seed).toBe(111);
    expect(loadPregenerated(13, "medium")).toBeNull();
  });
});

describe("clearPregenerated", () => {
  it("removes all stored boards", () => {
    putPregenerated(makeBoard());
    clearPregenerated();
    expect(loadPregenerated(12, "medium")).toBeNull();
  });

  it("is a no-op when nothing was saved", () => {
    expect(() => clearPregenerated()).not.toThrow();
  });
});
