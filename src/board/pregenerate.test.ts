import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newGame } from "../game/game";
import type { GenerateRequest } from "./generate.worker";
import { pregenSizes, takePregeneratedCells, PREGEN_MIN_SIZE, PREGEN_MAX_SIZE } from "./pregenerate";
import { putPregenerated } from "../persistence/pregen";

class FakeWorker {
  static instances: FakeWorker[] = [];

  terminated = false;
  posted: GenerateRequest[] = [];
  private listeners: {
    message: Array<(event: { data: unknown }) => void>;
    error: Array<(event: unknown) => void>;
  } = { message: [], error: [] };

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: GenerateRequest): void {
    this.posted.push(message);
  }

  addEventListener(type: "message" | "error", cb: (event: never) => void): void {
    this.listeners[type].push(cb as never);
  }

  terminate(): void {
    this.terminated = true;
  }

  respondOk(overrides: Partial<{ seed: number; attempts: number }> = {}): void {
    const req = this.posted[this.posted.length - 1];
    const data = {
      id: req.id,
      ok: true,
      size: req.size,
      regions: new Uint8Array(req.size * req.size),
      queenCols: new Uint8Array(req.size),
      attempts: overrides.attempts ?? 1,
      seed: overrides.seed ?? req.seed,
    };
    this.listeners.message.forEach((cb) => cb({ data }));
  }

  respondErr(message = "generation failed"): void {
    const req = this.posted[this.posted.length - 1];
    const data = { id: req.id, ok: false, name: "Error", message };
    this.listeners.message.forEach((cb) => cb({ data }));
  }
}

vi.stubGlobal("Worker", FakeWorker);

beforeEach(() => {
  localStorage.clear();
  FakeWorker.instances.length = 0;
  vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
});

afterEach(async () => {
  FakeWorker.instances.length = 0;
  const { cancelGeneration } = await import("./generate");
  cancelGeneration();
});

describe("pregenSizes()", () => {
  it("returns all sizes from PREGEN_MIN_SIZE to PREGEN_MAX_SIZE", () => {
    const sizes = pregenSizes();
    expect(sizes).toContain(PREGEN_MIN_SIZE);
    expect(sizes).toContain(PREGEN_MAX_SIZE);
    for (let s = PREGEN_MIN_SIZE; s <= PREGEN_MAX_SIZE; s++) {
      expect(sizes).toContain(s);
    }
  });

  it("puts playingSize first when in range", () => {
    const sizes = pregenSizes(14);
    expect(sizes[0]).toBe(14);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).not.toBe(14);
    }
  });

  it("returns all sizes even when playingSize is out of range", () => {
    const sizes = pregenSizes(20);
    expect(sizes.length).toBe(PREGEN_MAX_SIZE - PREGEN_MIN_SIZE + 1);
  });

  it("has no duplicates", () => {
    const sizes = pregenSizes(14);
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});

describe("takePregeneratedCells", () => {
  it("returns null below PREGEN_MIN_SIZE", () => {
    const game = newGame(11, 2);
    const result = takePregeneratedCells(game, 11, "medium");
    expect(result).toBeNull();
  });

  it("returns null above PREGEN_MAX_SIZE", () => {
    const game = newGame(16, 2);
    const result = takePregeneratedCells(game, 16, "medium");
    expect(result).toBeNull();
  });

  it("returns cells and seed when a board is stored", () => {
    const board = {
      size: 12,
      difficulty: "medium" as const,
      seed: 12345,
      regions: Array(144).fill(0).map((_, i) => i % 12),
      queenCols: Array(12).fill(0).map((_, i) => i),
    };
    putPregenerated(board);

    const game = newGame(12, 2);
    const result = takePregeneratedCells(game, 12, "medium");

    expect(result).not.toBeNull();
    expect(result!.seed).toBe(12345);
    expect(result!.cells).toHaveLength(12);
  });

  it("removes the board from storage after taking it", () => {
    const board = {
      size: 12,
      difficulty: "medium" as const,
      seed: 12345,
      regions: Array(144).fill(0).map((_, i) => i % 12),
      queenCols: Array(12).fill(0).map((_, i) => i),
    };
    putPregenerated(board);

    const game = newGame(12, 2);
    takePregeneratedCells(game, 12, "medium");

    const result = takePregeneratedCells(game, 12, "medium");
    expect(result).toBeNull();
  });
});
