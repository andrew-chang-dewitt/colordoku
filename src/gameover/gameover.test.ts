import { beforeEach, describe, expect, it, vi } from "vitest";
import { newGameOver } from "./gameover";

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  const onNewGame = vi.fn();
  const onChangeOptions = vi.fn();
  const gameOver = newGameOver({ onNewGame, onChangeOptions });
  document.body.append(gameOver.html);
  return { gameOver, onNewGame, onChangeOptions };
}

describe("newGameOver", () => {
  it("shows distinct messaging for a win, including the elapsed time", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 65_000 });
    expect(gameOver.html.open).toBe(true);
    expect(gameOver.html.textContent).toContain("won");
    expect(gameOver.html.textContent).toContain("1:05");
  });

  it("shows distinct messaging for a loss", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 2, elapsedMs: 12_000 });
    expect(gameOver.html.open).toBe(true);
    expect(gameOver.html.textContent).not.toContain("won");
  });

  it("ignores an attempt to dismiss it (Escape)", () => {
    const { gameOver } = mount();
    gameOver.show({ state: 1, elapsedMs: 0 });

    const cancelled = new Event("cancel", { cancelable: true });
    gameOver.html.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(true);
    expect(gameOver.html.open).toBe(true);
  });

  it("the 'new game, same size' action closes the modal and calls onNewGame", () => {
    const { gameOver, onNewGame } = mount();
    gameOver.show({ state: 1, elapsedMs: 0 });

    const button = [...gameOver.html.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New game"),
    )!;
    button.click();

    expect(onNewGame).toHaveBeenCalledOnce();
    expect(gameOver.html.open).toBe(false);
  });

  it("the 'change size' action closes the modal and calls onChangeOptions", () => {
    const { gameOver, onChangeOptions } = mount();
    gameOver.show({ state: 2, elapsedMs: 0 });

    const button = [...gameOver.html.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Change size"),
    )!;
    button.click();

    expect(onChangeOptions).toHaveBeenCalledOnce();
    expect(gameOver.html.open).toBe(false);
  });
});
