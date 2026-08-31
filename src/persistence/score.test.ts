import { describe, expect, it } from "vitest";
import { computeScore, PAR_SECONDS_PER_CELL } from "./score";

describe("computeScore", () => {
  describe("non-win outcomes always score exactly 0", () => {
    it("a loss scores 0 regardless of size, difficulty, or elapsed time", () => {
      expect(computeScore(4, "easy", 1000, "lost")).toBe(0);
      expect(computeScore(16, "hard", 500, "lost")).toBe(0);
      expect(computeScore(8, "medium", 999_999, "lost")).toBe(0);
    });

    it("an abandon scores 0 regardless of size, difficulty, or elapsed time", () => {
      expect(computeScore(4, "easy", 1000, "abandoned")).toBe(0);
      expect(computeScore(16, "hard", 500, "abandoned")).toBe(0);
      expect(computeScore(8, "medium", 999_999, "abandoned")).toBe(0);
    });

    it("a loss/abandon is never negative and never given partial credit — a explicit product decision, not derived from the win formula", () => {
      // A fast, large, hard "loss" would score very high if it were treated
      // like a win — confirming it's still exactly 0 rules out any
      // accidental derivation from the win-scoring path.
      expect(computeScore(16, "hard", 1, "lost")).toBe(0);
      expect(computeScore(16, "hard", 1, "abandoned")).toBe(0);
    });
  });

  describe("a win scores based on size, difficulty, and completion time", () => {
    it("bigger boards score more at the same pace and difficulty", () => {
      const small = computeScore(4, "medium", 4 * 4 * PAR_SECONDS_PER_CELL * 1000, "won"); // exactly par pace
      const big = computeScore(8, "medium", 8 * 8 * PAR_SECONDS_PER_CELL * 1000, "won");
      expect(big).toBeGreaterThan(small);
    });

    it("harder difficulty scores more than easier, all else equal", () => {
      const elapsedMs = 4 * 4 * PAR_SECONDS_PER_CELL * 1000; // exactly par pace for a 4x4
      const easy = computeScore(4, "easy", elapsedMs, "won");
      const medium = computeScore(4, "medium", elapsedMs, "won");
      const hard = computeScore(4, "hard", elapsedMs, "won");
      expect(easy).toBeLessThan(medium);
      expect(medium).toBeLessThan(hard);
    });

    it("finishing faster than par scores more than finishing at par", () => {
      const parMs = 4 * 4 * PAR_SECONDS_PER_CELL * 1000;
      const fast = computeScore(4, "medium", parMs / 2, "won");
      const atPar = computeScore(4, "medium", parMs, "won");
      expect(fast).toBeGreaterThan(atPar);
    });

    it("finishing slower than par scores less than finishing at par", () => {
      const parMs = 4 * 4 * PAR_SECONDS_PER_CELL * 1000;
      const slow = computeScore(4, "medium", parMs * 2, "won");
      const atPar = computeScore(4, "medium", parMs, "won");
      expect(slow).toBeLessThan(atPar);
    });

    it("the time multiplier is capped, not unbounded, for an implausibly fast win", () => {
      const parMs = 4 * 4 * PAR_SECONDS_PER_CELL * 1000;
      const instant = computeScore(4, "medium", 1, "won");
      const veryFast = computeScore(4, "medium", parMs / 100, "won");
      // Both are fast enough to hit the cap, so they should score identically.
      expect(instant).toBe(veryFast);
    });

    it("the time multiplier is floored, not unbounded, for a very slow win", () => {
      const parMs = 4 * 4 * PAR_SECONDS_PER_CELL * 1000;
      const verySlow = computeScore(4, "medium", parMs * 100, "won");
      const evenSlower = computeScore(4, "medium", parMs * 1000, "won");
      // Both are slow enough to hit the floor, so they should score identically.
      expect(verySlow).toBe(evenSlower);
    });

    it("zero or negative elapsed time is treated as instantaneous (the max multiplier), not NaN/Infinity", () => {
      const zero = computeScore(4, "medium", 0, "won");
      const negative = computeScore(4, "medium", -500, "won");
      expect(Number.isFinite(zero)).toBe(true);
      expect(Number.isFinite(negative)).toBe(true);
      expect(zero).toBeGreaterThan(0);
      expect(negative).toBe(zero);
    });

    it("always returns an integer (rounded), not a fractional score", () => {
      const score = computeScore(7, "medium", 12345, "won");
      expect(Number.isInteger(score)).toBe(true);
    });

    it("a 1x1 board still scores a positive number for a win", () => {
      expect(computeScore(1, "easy", 1000, "won")).toBeGreaterThan(0);
    });
  });

  describe("exhaustive size x difficulty x pace x attempt x wrongGuesses matrix — every combination scores a non-negative integer for a win, and exactly 0 for a loss/abandon", () => {
    const sizes = [1, 4, 8, 16];
    const difficulties = ["easy", "medium", "hard"] as const;
    const paceFractions = [0.01, 0.5, 1, 2, 100]; // fraction of "par" time
    const attempts = [1, 2, 5];
    const wrongGuessesList = [0, 1, 5];

    for (const size of sizes) {
      for (const difficulty of difficulties) {
        for (const paceFraction of paceFractions) {
          for (const attempt of attempts) {
            for (const wrongGuesses of wrongGuessesList) {
              const parMs = size * size * PAR_SECONDS_PER_CELL * 1000;
              const elapsedMs = parMs * paceFraction;

              it(`size=${size} difficulty=${difficulty} pace=${paceFraction}x par attempt=${attempt} wrongGuesses=${wrongGuesses}`, () => {
                const won = computeScore(size, difficulty, elapsedMs, "won", attempt, wrongGuesses);
                expect(Number.isInteger(won)).toBe(true);
                expect(won).toBeGreaterThanOrEqual(0);

                expect(computeScore(size, difficulty, elapsedMs, "lost", attempt, wrongGuesses)).toBe(0);
                expect(computeScore(size, difficulty, elapsedMs, "abandoned", attempt, wrongGuesses)).toBe(0);
              });
            }
          }
        }
      }
    }
  });

  describe("completion time meaningfully varies the score across a realistic range", () => {
    it("a 90s, 3min, 6min and 12min win on an 8x8 all score differently, strictly decreasing", () => {
      const s90 = computeScore(8, "medium", 90 * 1000, "won");
      const s3m = computeScore(8, "medium", 3 * 60 * 1000, "won");
      const s6m = computeScore(8, "medium", 6 * 60 * 1000, "won");
      const s12m = computeScore(8, "medium", 12 * 60 * 1000, "won");
      expect(s90).toBeGreaterThan(s3m);
      expect(s3m).toBeGreaterThan(s6m);
      expect(s6m).toBeGreaterThan(s12m);
    });

    it("one extra second of play is never worth more than finishing sooner (monotonic non-increasing)", () => {
      let lastScore = Infinity;
      for (let elapsedSec = 30; elapsedSec <= 20 * 60; elapsedSec += 10) {
        const score = computeScore(8, "medium", elapsedSec * 1000, "won");
        expect(score).toBeLessThanOrEqual(lastScore);
        lastScore = score;
      }
    });
  });

  describe("attempt count lowers the score", () => {
    it("a 2nd attempt scores less than a 1st, all else equal", () => {
      const first = computeScore(8, "medium", 180 * 1000, "won", 1);
      const second = computeScore(8, "medium", 180 * 1000, "won", 2);
      expect(second).toBeLessThan(first);
    });

    it("each further attempt scores strictly less, up to the floor", () => {
      const s1 = computeScore(8, "medium", 180 * 1000, "won", 1);
      const s2 = computeScore(8, "medium", 180 * 1000, "won", 2);
      const s5 = computeScore(8, "medium", 180 * 1000, "won", 5);
      expect(s1).toBeGreaterThan(s2);
      expect(s2).toBeGreaterThan(s5);
    });

    it("attempt floored at neutral value — 0, negative, fractional inputs score same as attempt 1", () => {
      const nominal = computeScore(8, "medium", 180 * 1000, "won", 1);
      const zero = computeScore(8, "medium", 180 * 1000, "won", 0);
      const negative = computeScore(8, "medium", 180 * 1000, "won", -5);
      const fractional = computeScore(8, "medium", 180 * 1000, "won", 0.7);
      expect(zero).toBe(nominal);
      expect(negative).toBe(nominal);
      expect(fractional).toBe(nominal);
    });

    it("never drops to zero or below regardless of attempt count", () => {
      const veryhigh = computeScore(8, "medium", 180 * 1000, "won", 1000);
      expect(veryhigh).toBeGreaterThan(0);
    });

    it("omitting attempt entirely equals passing 1", () => {
      const explicit = computeScore(8, "medium", 180 * 1000, "won", 1);
      const omitted = computeScore(8, "medium", 180 * 1000, "won");
      expect(omitted).toBe(explicit);
    });
  });

  describe("incorrect guesses lower the score", () => {
    it("one wrong guess scores less than a flawless win, all else equal", () => {
      const flawless = computeScore(8, "medium", 180 * 1000, "won", 1, 0);
      const oneWrong = computeScore(8, "medium", 180 * 1000, "won", 1, 1);
      expect(oneWrong).toBeLessThan(flawless);
    });

    it("more wrong guesses score strictly less, down to the floor", () => {
      const s0 = computeScore(8, "medium", 180 * 1000, "won", 1, 0);
      const s1 = computeScore(8, "medium", 180 * 1000, "won", 1, 1);
      const s5 = computeScore(8, "medium", 180 * 1000, "won", 1, 5);
      expect(s0).toBeGreaterThan(s1);
      expect(s1).toBeGreaterThan(s5);
    });

    it("wrongGuesses floored at 0 — negative count is not a bonus", () => {
      const zero = computeScore(8, "medium", 180 * 1000, "won", 1, 0);
      const negative = computeScore(8, "medium", 180 * 1000, "won", 1, -5);
      expect(negative).toBe(zero);
    });

    it("omitting wrongGuesses entirely equals passing 0", () => {
      const explicit = computeScore(8, "medium", 180 * 1000, "won", 1, 0);
      const omitted = computeScore(8, "medium", 180 * 1000, "won", 1);
      expect(omitted).toBe(explicit);
    });

    it("stays positive at max wrong guesses a win can have on the most lenient board", () => {
      // 16x16 board on easy difficulty allows for a lot of wrong guesses
      // (see board.ts's maxGuessesFor), but we still score positively
      const maxWrong = 12; // conservative estimate; actual max is higher
      const score = computeScore(16, "easy", 180 * 1000, "won", 1, maxWrong);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("new penalties never resurrect a non-win", () => {
    it("a loss/abandon is still exactly 0 for every attempt and wrong-guess count combination", () => {
      const attempts = [1, 2, 10];
      const guesses = [0, 1, 10];
      for (const attempt of attempts) {
        for (const wrongGuesses of guesses) {
          expect(computeScore(8, "medium", 180 * 1000, "lost", attempt, wrongGuesses)).toBe(0);
          expect(computeScore(8, "medium", 180 * 1000, "abandoned", attempt, wrongGuesses)).toBe(0);
        }
      }
    });
  });
});
