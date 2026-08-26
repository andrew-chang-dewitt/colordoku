import { describe, expect, it } from "vitest";
import { maxGuessesFor } from "./board";

describe("maxGuessesFor", () => {
  it("keeps the original 4x4 board at two guesses", () => {
    expect(maxGuessesFor(4)).toBe(2);
  });

  it("scales with board size", () => {
    expect(maxGuessesFor(8)).toBe(4);
    expect(maxGuessesFor(12)).toBe(6);
  });

  it("always leaves at least one guess", () => {
    expect(maxGuessesFor(1)).toBe(1);
  });
});
