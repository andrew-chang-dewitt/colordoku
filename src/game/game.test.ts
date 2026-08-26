import { describe, expect, it } from "vitest";
import classes from "./game.module.css";
import { newGame } from "./game";

// These pin the win/loss transitions, which never fired before: incFound and
// incGuess wrote `this.state == 1` / `== 2`, comparisons rather than assignments.

describe("newGame", () => {
  it("starts in the continuing state with every guess available", () => {
    const game = newGame(4, 2);
    expect(game.state).toBe(0);
    expect(game.guessesLeft).toBe(2);
    expect(game.queensFound).toBe(0);
  });

  it("wins once every queen is found", () => {
    const game = newGame(4, 2);
    for (let i = 0; i < 4; i++) game.incFound();
    expect(game.queensFound).toBe(4);
    expect(game.state).toBe(1);
  });

  it("stays in play while queens are still missing", () => {
    const game = newGame(4, 2);
    game.incFound();
    game.incFound();
    expect(game.state).toBe(0);
  });

  it("loses once the guesses run out", () => {
    const game = newGame(4, 2);
    game.incGuess();
    expect(game.state).toBe(0);
    game.incGuess();
    expect(game.guessesLeft).toBe(0);
    expect(game.state).toBe(2);
  });

  it("notifies onEnd listeners exactly once, on the win transition", () => {
    const game = newGame(4, 2);
    const seen: Array<0 | 1 | 2> = [];
    game.onEnd((state) => seen.push(state));

    game.incFound();
    game.incFound();
    expect(seen).toEqual([]);
    game.incFound();
    game.incFound();
    expect(seen).toEqual([1]);

    // A further incFound (were it ever called again) should not renotify.
    game.incFound();
    expect(seen).toEqual([1]);
  });

  it("notifies onEnd listeners exactly once, on the loss transition", () => {
    const game = newGame(4, 2);
    const seen: Array<0 | 1 | 2> = [];
    game.onEnd((state) => seen.push(state));

    game.incGuess();
    expect(seen).toEqual([]);
    game.incGuess();
    expect(seen).toEqual([2]);
  });

  it("supports multiple onEnd listeners", () => {
    const game = newGame(4, 1);
    const a: Array<1 | 2> = [];
    const b: Array<1 | 2> = [];
    game.onEnd((state) => a.push(state));
    game.onEnd((state) => b.push(state));

    game.incGuess();
    expect(a).toEqual([2]);
    expect(b).toEqual([2]);
  });

  it("marks one guess pip per wrong guess", () => {
    const game = newGame(4, 3);
    expect(game.html.children).toHaveLength(3);

    // Exact comparison, not a substring test: "unused" contains "used".
    const usedPips = () =>
      [...game.html.children].filter((pip) => pip.className === classes.used)
        .length;

    expect(usedPips()).toBe(0);
    game.incGuess();
    expect(usedPips()).toBe(1);
    game.incGuess();
    expect(usedPips()).toBe(2);
  });
});
