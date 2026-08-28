/**
 * Computes the score for a finished attempt — board size, difficulty, and
 * completion time in, a number out (see README's #user-score TODO).
 *
 * Product decision (direct from the user, not this file's own call):
 * **losing or abandoning always scores exactly 0** — no penalty, no
 * partial credit for either. Only a win earns points. That's why
 * computeScore's `status` parameter excludes "playing" entirely (there's
 * nothing to score yet — see history.ts's HistoryEntry.score doc comment
 * for how callers represent "not yet scored") and why "lost"/"abandoned"
 * both short-circuit to 0 up front rather than being derived from the win
 * formula the way an earlier (rejected) candidate would have.
 *
 * Lives in persistence/ rather than alongside the game/board modules
 * because its only consumer is persistence/history.ts's recordAttempt() —
 * this is scoring-for-history-tracking, not a live gameplay concern (the
 * live board doesn't display or use a running score at all).
 *
 * Pure and DOM/storage-free on purpose: trivially, exhaustively testable
 * across size/difficulty/time combinations without any of history.ts's
 * localStorage machinery.
 */

import type { Difficulty } from "../options/options";

/** Bigger boards are worth more, linearly in cell count. */
const BASE_PER_CELL = 10;

/**
 * A rough "expected" pace, in seconds per cell, that a completion time is
 * measured against — not derived from real player data (none exists yet),
 * just a reasonable starting guess. Finishing faster than this multiplies
 * the score up (capped at MAX_TIME_MULT); slower multiplies it down (capped
 * at MIN_TIME_MULT), so neither an implausibly fast nor a very slow win
 * produces an absurd result.
 */
const PAR_SECONDS_PER_CELL = 12;
const MIN_TIME_MULT = 0.5;
const MAX_TIME_MULT = 2.0;

/**
 * Applied even though difficulty has no effect on generation or the guess
 * count yet (see options.ts's difficulty selector comment and README's
 * #board-generation TODO) — the user's explicit call was that size AND
 * difficulty should both factor into score now, ahead of that gameplay
 * wiring landing.
 */
const DIFFICULTY_MULTIPLIERS: Record<Difficulty, number> = {
  easy: 0.8,
  medium: 1.0,
  hard: 1.3,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A finished attempt's outcome — deliberately excludes "playing", which has
 * no score to compute yet (callers should not call this while a game is
 * still in progress; see HistoryEntry.score's doc comment in history.ts).
 */
export type FinishedStatus = "won" | "lost" | "abandoned";

/**
 * `elapsedMs` should be the attempt's real elapsed play time (e.g.
 * timer.elapsedMs() in main.ts). Negative or zero elapsed time is treated
 * as instantaneous (the maximum time multiplier) rather than producing
 * NaN/Infinity — defensive against a caller passing a stale/zeroed timer
 * value, not an expected real input.
 */
export function computeScore(
  size: number,
  difficulty: Difficulty,
  elapsedMs: number,
  status: FinishedStatus,
): number {
  if (status !== "won") return 0;

  const cells = size * size;
  const base = BASE_PER_CELL * cells;
  const parSeconds = PAR_SECONDS_PER_CELL * cells;
  const elapsedSeconds = elapsedMs / 1000;

  const timeMult =
    elapsedSeconds <= 0
      ? MAX_TIME_MULT
      : clamp(parSeconds / elapsedSeconds, MIN_TIME_MULT, MAX_TIME_MULT);

  return Math.round(base * DIFFICULTY_MULTIPLIERS[difficulty] * timeMult);
}
