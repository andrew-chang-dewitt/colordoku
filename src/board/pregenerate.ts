import type { Game } from "../game/game";
import type { Difficulty } from "../options/options";
import {
  BackgroundPreempted, cellsFromArrays,
  generateRawInBackground, isGenerating, onGeneratingChange,
  cancelBackgroundGeneration,
} from "./generate";
import type { GeneratedCells } from "./generate";
import { hasPregenerated, putPregenerated, takePregenerated } from "../persistence/pregen";

export const PREGEN_MIN_SIZE = 12;
export const PREGEN_MAX_SIZE = 15; // NOT 16 — size 16 is being disabled separately as impractically slow

const START_DELAY_MS = 3_000;
const GAP_MS = 1_000;
const RETRY_MS = 5_000;
const MAX_FAILURES = 3;

export function pregenSizes(playingSize?: number): number[] {
  const sizes: number[] = [];
  for (let s = PREGEN_MIN_SIZE; s <= PREGEN_MAX_SIZE; s++) sizes.push(s);
  if (playingSize !== undefined && playingSize >= PREGEN_MIN_SIZE && playingSize <= PREGEN_MAX_SIZE) {
    return [playingSize, ...sizes.filter((s) => s !== playingSize)];
  }
  return sizes;
}

export function takePregeneratedCells(
  game: Game,
  size: number,
  difficulty: Difficulty,
): GeneratedCells | null {
  if (size < PREGEN_MIN_SIZE || size > PREGEN_MAX_SIZE) return null;
  const board = takePregenerated(size, difficulty);
  if (board === null) return null;
  return {
    cells: cellsFromArrays(game, size, Uint8Array.from(board.regions), Uint8Array.from(board.queenCols)),
    seed: board.seed,
  };
}

export interface PregenController { stop(): void }

let stopped = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures: Map<number, number> = new Map();
let unsubBusy: (() => void) | null = null;
let visListener: (() => void) | null = null;
let currentPlayingSize: number | undefined;
let currentDifficulty: Difficulty = "medium";

export function startPregeneration(config: { playingSize?: number; difficulty: Difficulty }): PregenController {
  stopPregeneration();
  stopped = false;
  failures = new Map();
  currentPlayingSize = config.playingSize;
  currentDifficulty = config.difficulty;

  unsubBusy = onGeneratingChange((busy) => { if (!busy) schedule(GAP_MS); });
  visListener = () => { if (!document.hidden) schedule(GAP_MS); };
  document.addEventListener("visibilitychange", visListener);

  schedule(START_DELAY_MS);

  return { stop: stopPregeneration };
}

function stopPregeneration(): void {
  stopped = true;
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (unsubBusy !== null) { unsubBusy(); unsubBusy = null; }
  if (visListener !== null) { document.removeEventListener("visibilitychange", visListener); visListener = null; }
  cancelBackgroundGeneration();
}

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (typeof ric === "function") ric(() => void tick(), { timeout: 10_000 });
    else void tick();
  }, delayMs);
}

async function tick(): Promise<void> {
  if (stopped) return;
  if (isGenerating()) return;
  if (typeof document !== "undefined" && document.hidden) return;

  const size = pregenSizes(currentPlayingSize).find(
    (s) => !hasPregenerated(s, currentDifficulty) && (failures.get(s) ?? 0) < MAX_FAILURES,
  );
  if (size === undefined) return;

  try {
    const raw = await generateRawInBackground(size, currentDifficulty);
    putPregenerated({
      size, difficulty: currentDifficulty, seed: raw.seed,
      regions: Array.from(raw.regions), queenCols: Array.from(raw.queenCols),
    });
    schedule(GAP_MS);
  } catch (err) {
    if (!(err instanceof BackgroundPreempted)) {
      failures.set(size, (failures.get(size) ?? 0) + 1);
    }
    schedule(RETRY_MS);
  }
}
