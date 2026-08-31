import type { Difficulty } from "../options/options";

export interface PregeneratedBoard {
  version: 1;
  size: number;
  difficulty: Difficulty;
  seed: number;
  regions: number[];
  queenCols: number[];
  createdAt: number;
}

const STORAGE_KEY = "colordoku:pregen";
const CURRENT_VERSION = 1;
const MAX_ENTRIES = 6;

export function hasPregenerated(size: number, difficulty: Difficulty): boolean {
  return loadPregenerated(size, difficulty) !== null;
}

export function loadPregenerated(size: number, difficulty: Difficulty): PregeneratedBoard | null {
  const entry = readAll().find((b) => b.size === size && b.difficulty === difficulty);
  return entry ?? null;
}

export function takePregenerated(size: number, difficulty: Difficulty): PregeneratedBoard | null {
  const all = readAll();
  const idx = all.findIndex((b) => b.size === size && b.difficulty === difficulty);
  if (idx === -1) return null;
  const [entry] = all.splice(idx, 1);
  writeAll(all);
  return entry;
}

export function putPregenerated(board: Omit<PregeneratedBoard, "version" | "createdAt">): void {
  const all = readAll().filter((b) => !(b.size === board.size && b.difficulty === board.difficulty));
  all.push({ ...board, version: CURRENT_VERSION, createdAt: Date.now() });
  while (all.length > MAX_ENTRIES) {
    let oldestIdx = 0;
    for (let i = 1; i < all.length; i++) {
      if (all[i].createdAt < all[oldestIdx].createdAt) oldestIdx = i;
    }
    all.splice(oldestIdx, 1);
  }
  writeAll(all);
}

export function clearPregenerated(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignored */ }
}

function readAll(): PregeneratedBoard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPregeneratedBoard);
  } catch {
    return [];
  }
}

function writeAll(list: PregeneratedBoard[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* ignored */ }
}

function isDifficultyValue(v: unknown): v is Difficulty {
  return v === "easy" || v === "medium" || v === "hard";
}

function isPregeneratedBoard(v: unknown): v is PregeneratedBoard {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  if (b.version !== CURRENT_VERSION) return false;
  if (typeof b.size !== "number" || !Number.isInteger(b.size) || b.size < 1) return false;
  if (!isDifficultyValue(b.difficulty)) return false;
  if (typeof b.seed !== "number") return false;
  if (!Array.isArray(b.regions) || b.regions.length !== b.size * b.size) return false;
  if (!b.regions.every((r) => Number.isInteger(r) && r >= 0 && r < (b.size as number))) return false;
  if (!Array.isArray(b.queenCols) || b.queenCols.length !== b.size) return false;
  if (!b.queenCols.every((c) => Number.isInteger(c) && c >= 0 && c < (b.size as number))) return false;
  if (typeof b.createdAt !== "number") return false;
  return true;
}
