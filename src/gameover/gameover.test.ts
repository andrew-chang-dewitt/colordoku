import { beforeEach, describe, expect, it, vi } from "vitest";
import { newGameOver } from "./gameover";

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  const onNewGame = vi.fn();
  const onChangeOptions = vi.fn();
  const onTryAgain = vi.fn();
  const getShareUrl = vi.fn(() => "http://example.com/test");
  const gameOver = newGameOver({
    onNewGame,
    onChangeOptions,
    onTryAgain,
    getShareUrl,
  });
  document.body.append(gameOver.html);
  return { gameOver, onNewGame, onChangeOptions, onTryAgain, getShareUrl };
}

describe("newGameOver", () => {
  it("shows distinct messaging for a win, including the elapsed time", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 65_000, score: 1234, size: 4 });
    expect(gameOver.html.open).toBe(true);
    expect(gameOver.html.textContent).toContain("won");
    expect(gameOver.html.textContent).toContain("1:05");
  });

  it("shows distinct messaging for a loss", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 2, elapsedMs: 12_000, score: 0, size: 4 });
    expect(gameOver.html.open).toBe(true);
    expect(gameOver.html.textContent).not.toContain("won");
  });

  it("ignores an attempt to dismiss it (Escape)", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 0, score: 1000, size: 4 });

    const cancelled = new Event("cancel", { cancelable: true });
    gameOver.html.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(true);
    expect(gameOver.html.open).toBe(true);
  });

  it("the 'new game, same size' action closes the modal and calls onNewGame", () => {
    const { gameOver, onNewGame } = mount();
    gameOver.show({ state: 1, elapsedMs: 0, score: 1000, size: 4 });

    const button = [...gameOver.html.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New game"),
    )!;
    button.click();

    expect(onNewGame).toHaveBeenCalledOnce();
    expect(gameOver.html.open).toBe(false);
  });

  it("the 'change size' action closes the modal and calls onChangeOptions", () => {
    const { gameOver, onChangeOptions } = mount();
    gameOver.show({ state: 2, elapsedMs: 0, score: 0, size: 4 });

    const button = [...gameOver.html.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Change size"),
    )!;
    button.click();

    expect(onChangeOptions).toHaveBeenCalledOnce();
    expect(gameOver.html.open).toBe(false);
  });

  it("shows score line on a win with the right number, but not on a loss", () => {
    const { gameOver } = mount();

    // Win: should show score
    gameOver.show({ state: 1, elapsedMs: 65_000, score: 1234, size: 4 });
    expect(gameOver.html.textContent).toContain("Score: 1234");

    // Loss: should not show score
    gameOver.show({ state: 2, elapsedMs: 12_000, score: 0, size: 4 });
    const scoreElements = gameOver.html.querySelectorAll("p");
    const scoreLine = [...scoreElements].find((p) =>
      p.textContent?.includes("Score:"),
    );
    expect(scoreLine?.hidden).toBe(true);
  });

  it("shows share button on win but not on loss", () => {
    const { gameOver } = mount();

    // Win: share button visible
    gameOver.show({ state: 1, elapsedMs: 65_000, score: 1234, size: 4 });
    const shareButton = [...gameOver.html.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Share"),
    );
    expect(shareButton?.hidden).toBe(false);

    // Loss: share button hidden
    gameOver.show({ state: 2, elapsedMs: 12_000, score: 0, size: 4 });
    expect(shareButton?.hidden).toBe(true);
  });

  it("the 'try again' action on a loss closes the modal and calls onTryAgain once", () => {
    const { gameOver, onTryAgain } = mount();
    gameOver.show({ state: 2, elapsedMs: 12_000, score: 0, size: 4 });

    const button = [...gameOver.html.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Try again"),
    )!;
    button.click();

    expect(onTryAgain).toHaveBeenCalledOnce();
    expect(gameOver.html.open).toBe(false);
  });

  it("does not show 'try again' on a win", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 65_000, score: 1234, size: 4 });

    const tryAgainButton = [...gameOver.html.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Try again"),
    );
    expect(tryAgainButton?.hidden).toBe(true);
  });

  it("confetti container has children after show() on a win", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 65_000, score: 1234, size: 4 });

    // Query for the confetti container by getting the first div child (confetti is appended first)
    const confettiContainer = gameOver.html.querySelector("div");
    expect(confettiContainer).toBeTruthy();
    expect(confettiContainer?.children.length).toBeGreaterThan(0);
  });

  it("confetti container is empty after show() on a loss", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 2, elapsedMs: 12_000, score: 0, size: 4 });

    // Query for the confetti container by getting the first div child (confetti is appended first)
    const confettiContainer = gameOver.html.querySelector("div");
    expect(confettiContainer?.children.length).toBe(0);
  });
});
