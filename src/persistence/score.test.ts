import { describe, expect, it } from "vitest";
import { computeScore } from "./score";

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
      const small = computeScore(4, "medium", 4 * 4 * 12 * 1000, "won"); // exactly par pace
      const big = computeScore(8, "medium", 8 * 8 * 12 * 1000, "won");
      expect(big).toBeGreaterThan(small);
    });

    it("harder difficulty scores more than easier, all else equal", () => {
      const elapsedMs = 4 * 4 * 12 * 1000; // exactly par pace for a 4x4
      const easy = computeScore(4, "easy", elapsedMs, "won");
      const medium = computeScore(4, "medium", elapsedMs, "won");
      const hard = computeScore(4, "hard", elapsedMs, "won");
      expect(easy).toBeLessThan(medium);
      expect(medium).toBeLessThan(hard);
    });

    it("finishing faster than par scores more than finishing at par", () => {
      const parMs = 4 * 4 * 12 * 1000;
      const fast = computeScore(4, "medium", parMs / 2, "won");
      const atPar = computeScore(4, "medium", parMs, "won");
      expect(fast).toBeGreaterThan(atPar);
    });

    it("finishing slower than par scores less than finishing at par", () => {
      const parMs = 4 * 4 * 12 * 1000;
      const slow = computeScore(4, "medium", parMs * 2, "won");
      const atPar = computeScore(4, "medium", parMs, "won");
      expect(slow).toBeLessThan(atPar);
    });

    it("the time multiplier is capped, not unbounded, for an implausibly fast win", () => {
      const parMs = 4 * 4 * 12 * 1000;
      const instant = computeScore(4, "medium", 1, "won");
      const veryFast = computeScore(4, "medium", parMs / 100, "won");
      // Both are fast enough to hit the cap, so they should score identically.
      expect(instant).toBe(veryFast);
    });

    it("the time multiplier is floored, not unbounded, for a very slow win", () => {
      const parMs = 4 * 4 * 12 * 1000;
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

  describe("exhaustive size x difficulty x pace matrix — every combination scores a non-negative integer for a win, and exactly 0 for a loss/abandon", () => {
    const sizes = [1, 4, 8, 16];
    const difficulties = ["easy", "medium", "hard"] as const;
    const paceFractions = [0.01, 0.5, 1, 2, 100]; // fraction of "par" time

    for (const size of sizes) {
      for (const difficulty of difficulties) {
        for (const paceFraction of paceFractions) {
          const parMs = size * size * 12 * 1000;
          const elapsedMs = parMs * paceFraction;

          it(`size=${size} difficulty=${difficulty} pace=${paceFraction}x par`, () => {
            const won = computeScore(size, difficulty, elapsedMs, "won");
            expect(Number.isInteger(won)).toBe(true);
            expect(won).toBeGreaterThanOrEqual(0);

            expect(computeScore(size, difficulty, elapsedMs, "lost")).toBe(0);
            expect(computeScore(size, difficulty, elapsedMs, "abandoned")).toBe(0);
          });
        }
      }
    }
  });
});
