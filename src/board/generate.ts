import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import type { Game } from "../game/game";
import type { Difficulty } from "../options/options";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";

/**
 * style.css defines --color-group-0 through --color-group-15 and matching
 * button.group-N rules, so a region id of 16 or more would render with no
 * background colour at all. This is a palette limit; the Rust crate goes to 32.
 */
export const MAX_SIZE = 16;
export const MIN_SIZE = 4;

/**
 * Sizes where generation is slow enough to be worth warning a player about,
 * and the threshold at and above which generation races several workers
 * instead of running just one. Measured worst case with a single worker: 13
 * is under a second, 14 runs to ~20s and 15 to ~47s. Set to 10 so the warning
 * & cancel button — and racing — kick in on unexpectedly slow generation too;
 * effectively unseen when generating fast anyway.
 */
export const SLOW_SIZE = 10;

/**
 * Ceiling on how many workers a single generation races, independent of
 * hardware. Past this, races help less (each extra worker's marginal cut to
 * expected wall time shrinks) while wasm-instantiation and memory overhead
 * keep growing, so this bounds the worst case on high-core-count machines.
 * See the generator-parallelism investigation notes for the measurements
 * behind this — real racing at n=14 measured ~2.8x at K=4, ~8.8x at K=8,
 * ~22.6x at K=12, i.e. clearly sublinear already by K=8.
 */
const MAX_RACERS = 8;

/** Boards of 2 or 3 cells a side are impossible; 1 is the trivial board. */
export function isSupportedSize(size: number): boolean {
  return (
    Number.isInteger(size) && (size === 1 || (size >= MIN_SIZE && size <= MAX_SIZE))
  );
}

/**
 * How many workers to race for a fresh (non-reproducing) generation at a
 * size that's actually worth racing. Scales toward the device's reported
 * core count so a low-end/mobile device isn't forced into contention it
 * can't back up, capped at MAX_RACERS so a high-core-count machine doesn't
 * spawn more racers than pays off. Falls back to a conservative default of 4
 * when the browser doesn't report a usable core count.
 */
function raceWidth(): number {
  const cores =
    typeof navigator === "object" && navigator !== null
      ? navigator.hardwareConcurrency
      : undefined;
  const usable = typeof cores === "number" && Number.isFinite(cores) && cores >= 1 ? cores : 4;
  return Math.max(1, Math.min(MAX_RACERS, Math.floor(usable)));
}

/**
 * Derives a worker's seed from a race's base seed and its index among the
 * racers, so K racers get K well-distributed, reproducible-from-(base,index)
 * seeds — a cheap 32-bit avalanche mix (murmur3's finalizer), not a
 * cryptographic hash: it only needs to keep sibling seeds from colliding, not
 * to resist attack. Mirrors in spirit (not bit-for-bit) the splitmix64
 * derivation `generator/src/rng.rs` uses for its own internal state.
 */
function deriveSeed(base: number, index: number): number {
  let x = (base ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

// --- worker plumbing ------------------------------------------------------

interface Pending {
  resolve: (value: GenerateResponse & { ok: true }) => void;
  reject: (reason: Error) => void;
}

/**
 * A pool of already-spawned (and therefore already wasm-instantiating or
 * -instantiated) workers, reused across calls where possible. Sized up to
 * whatever the largest race so far has needed; `preload()` only warms the
 * first slot, since most generations (anything below SLOW_SIZE, or replaying
 * an explicit seed) never need more than one worker.
 */
let pool: Worker[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;

function spawnWorker(): Worker {
  const w = new Worker(new URL("./generate.worker.ts", import.meta.url), {
    type: "module",
  });
  w.addEventListener("message", (event: MessageEvent<GenerateResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);

    if (message.ok) {
      entry.resolve(message);
    } else {
      const error =
        message.name === "RangeError"
          ? new RangeError(message.message)
          : new Error(message.message);
      entry.reject(error);
    }
  });
  w.addEventListener("error", (event) => {
    failAll(new Error(`board generator worker failed: ${event.message}`));
  });
  return w;
}

/** Grows the pool to at least `n` workers, reusing any that already exist. */
function ensurePoolSize(n: number): Worker[] {
  while (pool.length < n) pool.push(spawnWorker());
  return pool;
}

function failAll(reason: Error): void {
  for (const entry of pending.values()) entry.reject(reason);
  pending.clear();
  for (const w of pool) w.terminate();
  pool = [];
}

/**
 * Stop any in-flight generation and drop every pooled worker.
 *
 * Generation is one synchronous Rust call, so terminating a worker is the
 * only way to interrupt it — there is no cooperative cancellation point
 * inside. That applies to every racer in a race, not just one, so this drops
 * the whole pool.
 */
export function cancelGeneration(): void {
  failAll(new Error("board generation cancelled"));
}

/** Start one worker and let it instantiate wasm before a board is asked for.
 * Only warms the slot every generation needs; a race warms its extra workers
 * lazily, on first use. */
export function preload(): void {
  ensurePoolSize(1);
}

function randomSeed(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0;
}

// --- the API --------------------------------------------------------------

/**
 * Builds the cell grid from the generator's flat output.
 *
 * Kept separate from generateCells, and pure, so it can be unit tested without
 * spinning up a worker or instantiating wasm.
 */
export function cellsFromArrays(
  game: Game,
  size: number,
  regions: Uint8Array,
  queenCols: Uint8Array,
): Cell[][] {
  if (regions.length !== size * size) {
    throw new Error(`expected ${size * size} region ids, got ${regions.length}`);
  }
  if (queenCols.length !== size) {
    throw new Error(`expected ${size} queen columns, got ${queenCols.length}`);
  }

  const cells: Cell[][] = [];
  for (let r = 0; r < size; r++) {
    const row: Cell[] = [];
    const queenCol = queenCols[r];
    for (let c = 0; c < size; c++) {
      row.push(newCell(game, regions[r * size + c], c === queenCol));
    }
    cells.push(row);
  }
  return cells;
}

/**
 * Generate a board with exactly one solution and return its cells.
 *
 * The same seed always produces the same board. Passing an explicit `seed`
 * always resolves through exactly one worker, so it is fully reproducible —
 * that is what makes a saved game or a `?board-id=` link reliable. Omitting
 * `seed` asks for a fresh board instead: at sizes at or above SLOW_SIZE, that
 * races several workers (see `raceWidth`) against independently derived
 * seeds and returns whichever finishes first, since nothing about which
 * racer wins should ever need to be reproduced — only the board it returns
 * does, via the `seed` on the result.
 *
 * Rejects with RangeError for an unsupported size, or Error if every racer
 * gives up or generation is cancelled.
 *
 * The work runs in one or more Web Workers, so the page stays responsive even
 * at the sizes that take tens of seconds. Pass a signal to abort — note that
 * aborting terminates every worker involved, since the underlying Rust call
 * cannot be interrupted.
 */
export interface GeneratedCells {
  cells: Cell[][];
  /**
   * The seed actually used to produce this board. Always equal to the
   * `seed` argument when one was passed. When none was passed, this is
   * whichever racer's derived seed won — the only way a caller can later
   * reproduce this exact board (e.g. resuming a saved game, or a
   * `?board-id=` link), since the winner isn't knowable in advance.
   */
  seed: number;
}

export async function generateCells(
  game: Game,
  size: number,
  difficulty: Difficulty,
  seed?: number,
  signal?: AbortSignal,
): Promise<GeneratedCells> {
  if (!isSupportedSize(size)) {
    throw new RangeError(
      `unsupported board size ${size}: must be 1, or ${MIN_SIZE} to ${MAX_SIZE}`,
    );
  }
  signal?.throwIfAborted();

  // An explicit seed names one specific board, so it always runs single-worker
  // — racing would make no sense (and no difference) when there's only one
  // seed to try. Only a fresh, caller-doesn't-care-which board races.
  const explicit = seed !== undefined;
  const width = explicit || size < SLOW_SIZE ? 1 : raceWidth();

  const base = explicit ? (seed as number) >>> 0 : randomSeed();
  const seeds = width === 1 ? [base] : Array.from({ length: width }, (_, i) => deriveSeed(base, i));

  const workers = ensurePoolSize(width).slice(0, width);
  const idToWorker = new Map<number, Worker>();

  let onAbort: (() => void) | undefined;
  try {
    const winner = await new Promise<GenerateResponse & { ok: true }>((resolve, reject) => {
      let settled = false;
      let remaining = workers.length;

      onAbort = () => {
        for (const id of idToWorker.keys()) pending.delete(id);
        // Terminating every racer is the only way to stop the Rust call.
        cancelGeneration();
        reject(new Error("board generation cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      workers.forEach((worker, i) => {
        const id = nextId++;
        idToWorker.set(id, worker);
        pending.set(id, {
          resolve: (message) => {
            if (settled) return; // a sibling already won this race
            settled = true;
            resolve(message);
          },
          reject: (err) => {
            if (settled) return; // a sibling already won; this racer's failure is moot
            remaining -= 1;
            if (remaining === 0) reject(err);
            // otherwise: a sibling racer may still succeed, so keep waiting
          },
        });
        worker.postMessage({ id, size, seed: seeds[i], difficulty } satisfies GenerateRequest);
      });
    });

    // The winner is done and free to reuse; every other racer is still
    // synchronously blocked inside a Rust call that would otherwise run to
    // completion for nothing, so terminate them and drop them from the pool.
    const winnerWorker = idToWorker.get(winner.id);
    for (const [id, worker] of idToWorker) {
      if (worker === winnerWorker) continue;
      pending.delete(id);
      worker.terminate();
      pool = pool.filter((w) => w !== worker);
    }

    return {
      cells: cellsFromArrays(game, size, winner.regions, winner.queenCols),
      seed: winner.seed,
    };
  } finally {
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    for (const id of idToWorker.keys()) pending.delete(id);
  }
}
