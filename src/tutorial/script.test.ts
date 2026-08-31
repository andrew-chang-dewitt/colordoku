import { describe, it, expect } from "vitest";
import { STEPS } from "./script";
import { newTutorialBoard } from "./board";

describe("tutorial script.ts", () => {
  it("all step IDs are unique", () => {
    const ids = STEPS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all await coordinates are within bounds", () => {
    for (const step of STEPS) {
      if (step.await) {
        expect(step.await.coord.row).toBeGreaterThanOrEqual(0);
        expect(step.await.coord.row).toBeLessThan(4);
        expect(step.await.coord.col).toBeGreaterThanOrEqual(0);
        expect(step.await.coord.col).toBeLessThan(4);
      }
    }
  });

  it("all cell anchor coordinates are within bounds", () => {
    for (const step of STEPS) {
      if (step.anchor.kind === "cell") {
        expect(step.anchor.coord.row).toBeGreaterThanOrEqual(0);
        expect(step.anchor.coord.row).toBeLessThan(4);
        expect(step.anchor.coord.col).toBeGreaterThanOrEqual(0);
        expect(step.anchor.coord.col).toBeLessThan(4);
      } else if (step.anchor.kind === "cells") {
        for (const coord of step.anchor.coords) {
          expect(coord.row).toBeGreaterThanOrEqual(0);
          expect(coord.row).toBeLessThan(4);
          expect(coord.col).toBeGreaterThanOrEqual(0);
          expect(coord.col).toBeLessThan(4);
        }
      }
    }
  });

  it("replaying the script from a fresh board ends with game won", async () => {
    const board = newTutorialBoard();

    // Replay every scripted move
    for (let stepIndex = 0; stepIndex < STEPS.length; stepIndex++) {
      const step = STEPS[stepIndex];

      // Skip the final help button step (can't test the actual gesture)
      if (step.id === "help-button") break;

      // Run enter side effects
      if (step.enter) {
        step.enter(board);
      }

      // Execute await gestures
      if (step.await) {
        const cell = board.cellAt(step.await.coord);
        if (step.await.action === "commit") {
          cell.commit();
          // Wait for the setTimeout(0) in commitGuess to resolve
          await new Promise((resolve) => setTimeout(resolve, 0));
        } else if (step.await.action === "mark") {
          cell.mark(1);
        }
      }
    }

    // The finish step marks all cells but awaits a win (doesn't specify which cells to commit).
    // In the real game, the player would commit the two remaining queens.
    // For the test, we do it manually to complete the board:
    const cell23 = board.cellAt({ row: 2, col: 3 });
    const cell31 = board.cellAt({ row: 3, col: 1 });

    expect(cell23.queen).toBe(true); // Verify these are queens
    expect(cell31.queen).toBe(true);
    expect(cell23.frozen).toBe(false); // Should not be frozen yet
    expect(cell31.frozen).toBe(false);

    // Check how many queens have been found before committing
    const foundBefore = board.game.queensFound;
    cell23.commit();
    // Wait for the setTimeout(0) in commitGuess to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));
    const foundAfter23 = board.game.queensFound;

    if (foundAfter23 === foundBefore) {
      // (2,3) wasn't a queen or was already committed, try (3,1)
      cell31.commit();
    } else if (board.game.queensFound < 4) {
      // (2,3) was a queen, now try (3,1)
      cell31.commit();
    }

    // Wait for the second commit's setTimeout(0)
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Final state check
    expect(board.game.state).toBe(1); // Won
    expect(board.game.queensFound).toBe(4); // All 4 queens found
    expect(board.game.guessesLeft).toBe(1); // Exactly one guess spent (started with 2, spent 1)

    board.dispose();
  });

  it("panel visibility alternates correctly", () => {
    // Act 1: hidden (welcome only)
    expect(STEPS[0].panel).toBe("hidden");

    // Act 2: shown (many steps)
    for (let i = 1; i < STEPS.length - 1; i++) {
      expect(STEPS[i].panel).toBe("shown");
    }

    // Act 3: hidden
    expect(STEPS[STEPS.length - 1].panel).toBe("hidden");
  });

  it("has exactly 14 steps", () => {
    expect(STEPS.length).toBe(14);
  });

  it("first step is welcome (no anchor)", () => {
    expect(STEPS[0].anchor.kind).toBe("none");
  });

  it("last step points at help button", () => {
    expect(STEPS[STEPS.length - 1].anchor.kind).toBe("helpButton");
  });

  it("the second-to-last step (finish) has awaitWin flag", () => {
    expect(STEPS[STEPS.length - 2].awaitWin).toBe(true);
  });
});
