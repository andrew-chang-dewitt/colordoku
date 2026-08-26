import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newGame } from "../game/game";
import type { GenerateRequest } from "./generate.worker";

// Exercises the racing worker-pool orchestration in generate.ts — spawning
// several workers for a fresh board at/above SLOW_SIZE, taking the first
// success, terminating the rest, and surfacing an error only once every
// racer has failed. This is deliberately separate from generate.test.ts,
// which sticks to the pure, worker-free half of the module: real wasm
// generation is proven by the Rust suite, but the pool/race bookkeeping here
// is pure orchestration logic worth covering directly, with a fake Worker
// standing in for the real one.

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

  /** Simulates this worker's most recent request succeeding. */
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

  /** Simulates this worker's most recent request failing. */
  respondErr(message = "generation failed"): void {
    const req = this.posted[this.posted.length - 1];
    const data = { id: req.id, ok: false, name: "Error", message };
    this.listeners.message.forEach((cb) => cb({ data }));
  }
}

vi.stubGlobal("Worker", FakeWorker);

describe("generateCells racing", () => {
  beforeEach(() => {
    FakeWorker.instances.length = 0;
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
  });

  afterEach(async () => {
    // Drop every pooled fake worker so the next test starts from a clean
    // pool and its own spawn count is exactly what it triggers itself.
    const { cancelGeneration } = await import("./generate");
    cancelGeneration();
    vi.unstubAllGlobals();
    vi.stubGlobal("Worker", FakeWorker);
  });

  it("races several workers for a fresh board at/above SLOW_SIZE and returns the winner's seed", async () => {
    const { generateCells, SLOW_SIZE } = await import("./generate");
    const game = newGame(SLOW_SIZE, 2);

    const promise = generateCells(game, SLOW_SIZE);

    // hardwareConcurrency=4, under MAX_RACERS=8, so exactly 4 racers spawn.
    expect(FakeWorker.instances).toHaveLength(4);
    // Racers get independently derived seeds, not all the same one.
    const postedSeeds = FakeWorker.instances.map((w) => w.posted[0].seed);
    expect(new Set(postedSeeds).size).toBe(4);

    FakeWorker.instances[1].respondOk({ seed: 4242 });
    const result = await promise;

    expect(result.seed).toBe(4242);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    expect(FakeWorker.instances[1].terminated).toBe(false);
    expect(FakeWorker.instances[2].terminated).toBe(true);
    expect(FakeWorker.instances[3].terminated).toBe(true);
  });

  it("does not race below SLOW_SIZE", async () => {
    const { generateCells, SLOW_SIZE } = await import("./generate");
    const game = newGame(SLOW_SIZE - 1, 2);

    const promise = generateCells(game, SLOW_SIZE - 1);
    expect(FakeWorker.instances).toHaveLength(1);

    FakeWorker.instances[0].respondOk({ seed: 777 });
    await expect(promise).resolves.toMatchObject({ seed: 777 });
  });

  it("never races when an explicit seed is passed, even at/above SLOW_SIZE", async () => {
    const { generateCells, SLOW_SIZE } = await import("./generate");
    const game = newGame(SLOW_SIZE, 2);

    const promise = generateCells(game, SLOW_SIZE, 999);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted[0].seed).toBe(999);

    FakeWorker.instances[0].respondOk({ seed: 999 });
    await expect(promise).resolves.toMatchObject({ seed: 999 });
  });

  it("surfaces an error only once every racer has failed", async () => {
    const { generateCells, SLOW_SIZE } = await import("./generate");
    const game = newGame(SLOW_SIZE, 2);

    const promise = generateCells(game, SLOW_SIZE);
    expect(FakeWorker.instances).toHaveLength(4);

    // Swallow the eventual rejection so it isn't reported as unhandled while
    // the test still checks that it hasn't happened yet.
    let rejected = false;
    promise.catch(() => {
      rejected = true;
    });

    FakeWorker.instances[0].respondErr("nope 0");
    FakeWorker.instances[1].respondErr("nope 1");
    FakeWorker.instances[2].respondErr("nope 2");
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected).toBe(false);

    FakeWorker.instances[3].respondErr("nope 3");
    await expect(promise).rejects.toThrow("nope 3");
  });

  it("respects MAX_RACERS on a high-core-count machine", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 64 });
    const { generateCells, SLOW_SIZE } = await import("./generate");
    const game = newGame(SLOW_SIZE, 2);

    const promise = generateCells(game, SLOW_SIZE);
    expect(FakeWorker.instances).toHaveLength(8); // MAX_RACERS

    FakeWorker.instances[0].respondOk({ seed: 1 });
    await promise;
  });
});
