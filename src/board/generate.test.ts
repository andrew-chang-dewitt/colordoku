import { describe, expect, it } from "vitest";
import { newGame } from "../game/game";
import { cellsFromArrays, isSupportedSize, MAX_SIZE } from "./generate";

// These cover the pure half of the adapter. Generation itself is proven in the
// Rust test suite — instantiating the wasm module under Node would mean building
// a second package just for tests, for no extra coverage.

describe("isSupportedSize", () => {
  it("accepts the trivial board and everything from 4 to the palette limit", () => {
    expect(isSupportedSize(1)).toBe(true);
    expect(isSupportedSize(4)).toBe(true);
    expect(isSupportedSize(MAX_SIZE)).toBe(true);
  });

  it("rejects the sizes with no valid board", () => {
    expect(isSupportedSize(0)).toBe(false);
    expect(isSupportedSize(2)).toBe(false);
    expect(isSupportedSize(3)).toBe(false);
  });

  it("rejects sizes past the palette and non-integers", () => {
    expect(isSupportedSize(MAX_SIZE + 1)).toBe(false);
    expect(isSupportedSize(4.5)).toBe(false);
    expect(isSupportedSize(NaN)).toBe(false);
  });
});

describe("cellsFromArrays", () => {
  // The README's worked example.
  const size = 4;
  const regions = new Uint8Array([
    1, 1, 1, 1,
    0, 1, 2, 2,
    2, 1, 2, 3,
    2, 2, 2, 3,
  ]);
  const queenCols = new Uint8Array([2, 0, 3, 1]);

  it("shapes the flat arrays into rows without transposing", () => {
    const cells = cellsFromArrays(newGame(size, 2), size, regions, queenCols);

    expect(cells).toHaveLength(size);
    expect(cells.every((row) => row.length === size)).toBe(true);
    // Row 1 is 0,1,2,2 — if rows and columns were swapped this would read 1,1,1,1.
    expect(cells[1].map((cell) => cell.group)).toEqual([0, 1, 2, 2]);
  });

  it("marks exactly one queen per row, in the right column", () => {
    const cells = cellsFromArrays(newGame(size, 2), size, regions, queenCols);

    cells.forEach((row, r) => {
      const queens = row.filter((cell) => cell.queen);
      expect(queens).toHaveLength(1);
      expect(row.findIndex((cell) => cell.queen)).toBe(queenCols[r]);
    });
  });

  it("colours cells by region", () => {
    const cells = cellsFromArrays(newGame(size, 2), size, regions, queenCols);
    expect(cells[1][0].html.className).toContain("group-0");
    expect(cells[0][0].html.className).toContain("group-1");
  });

  it("rejects arrays that do not match the size", () => {
    const game = newGame(size, 2);
    expect(() => cellsFromArrays(game, size, new Uint8Array(15), queenCols)).toThrow(
      /expected 16 region ids/,
    );
    expect(() => cellsFromArrays(game, size, regions, new Uint8Array(3))).toThrow(
      /expected 4 queen columns/,
    );
  });
});
