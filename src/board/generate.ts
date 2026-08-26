import type { Cell } from "../cell/cell";
import { newCell } from "../cell/cell";
import type { Game } from "../game/game";
import type { GenerateRequest, GenerateResponse } from "./generate.worker";

/**
 * style.css defines --color-group-0 through --color-group-15 and matching
 * button.group-N rules, so a region id of 16 or more would render with no
 * background colour at all. This is a palette limit; the Rust crate goes to 32.
 */
export const MAX_SIZE = 16;
export const MIN_SIZE = 4;

/**
 * Sizes where generation is slow enough to be worth warning a player about.
 * Measured worst case: 13 is under a second, 14 runs to ~20s and 15 to ~47s.
 * Set to 10 to ensure warning & cancel button shown in unexpectedly slow
 * generation cases -- effectively unseen when generating fast anways.
 */
export const SLOW_SIZE = 10;

/** Boards of 2 or 3 cells a side are impossible; 1 is the trivial board. */
export function isSupportedSize(size: number): boolean {
  return (
    Number.isInteger(size) && (size === 1 || (size >= MIN_SIZE && size <= MAX_SIZE))
  );
}

// --- worker plumbing ------------------------------------------------------

interface Pending {
  resolve: (value: GenerateResponse & { ok: true }) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL("./generate.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<GenerateResponse>) => {
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
    worker.addEventListener("error", (event) => {
      failAll(new Error(`board generator worker failed: ${event.message}`));
    });
  }
  return worker;
}

function failAll(reason: Error): void {
  for (const entry of pending.values()) entry.reject(reason);
  pending.clear();
  worker?.terminate();
  worker = null;
}

/**
 * Stop any in-flight generation and drop the worker.
 *
 * Generation is one synchronous Rust call, so terminating the worker is the only
 * way to interrupt it — there is no cooperative cancellation point inside.
 */
export function cancelGeneration(): void {
  failAll(new Error("board generation cancelled"));
}

/** Start the worker and let it instantiate wasm before a board is asked for. */
export function preload(): void {
  getWorker();
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
 * The same seed always produces the same board; omit it for a random one.
 * Rejects with RangeError for an unsupported size, or Error if the generator
 * gives up or is cancelled.
 *
 * The work runs in a Web Worker, so the page stays responsive even at the sizes
 * that take tens of seconds. Pass a signal to abort — note that aborting
 * terminates the worker, since the underlying Rust call cannot be interrupted.
 */
export async function generateCells(
  game: Game,
  size: number,
  seed: number = randomSeed(),
  signal?: AbortSignal,
): Promise<Cell[][]> {
  if (!isSupportedSize(size)) {
    throw new RangeError(
      `unsupported board size ${size}: must be 1, or ${MIN_SIZE} to ${MAX_SIZE}`,
    );
  }
  signal?.throwIfAborted();

  const id = nextId++;
  const request: GenerateRequest = { id, size, seed: seed >>> 0 };

  let onAbort: (() => void) | undefined;
  try {
    const result = await new Promise<GenerateResponse & { ok: true }>(
      (resolve, reject) => {
        pending.set(id, { resolve, reject });

        onAbort = () => {
          pending.delete(id);
          // Terminating the worker is the only way to stop the Rust call.
          cancelGeneration();
          reject(new Error("board generation cancelled"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        getWorker().postMessage(request);
      },
    );

    return cellsFromArrays(game, size, result.regions, result.queenCols);
  } finally {
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
    pending.delete(id);
  }
}
