import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newUserMenu } from "./usermenu";

let disposers: Array<() => void> = [];

function mount(
  onOpenHistory: () => void = vi.fn(),
  onOpenScoreView: () => void = vi.fn(),
  onOpenPreferences: () => void = vi.fn(),
) {
  const menu = newUserMenu({ onOpenHistory, onOpenScoreView, onOpenPreferences });
  disposers.push(menu.dispose);
  document.body.append(menu.html);
  const button = menu.html.querySelector<HTMLButtonElement>("button#user-menu")!;
  const panel = menu.html.querySelector<HTMLDivElement>('[aria-label="Profile menu"]')!;
  return { menu, button, panel };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  disposers.forEach((dispose) => dispose());
  disposers = [];
});

describe("the trigger button", () => {
  it("has an accessible name even though it has no visible text (icon-only)", () => {
    const { button } = mount();
    expect(button.textContent?.trim()).toBe("");
    expect(button.getAttribute("aria-label")).toBe("Menu");
  });

  it("announces itself as a popup trigger, closed by default", () => {
    const { button } = mount();
    expect(button.getAttribute("aria-haspopup")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the menu on click and reports it via aria-expanded", () => {
    const { button, panel } = mount();
    button.click();
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles closed again on a second click", () => {
    const { button, panel } = mount();
    button.click();
    button.click();
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("moves focus into the menu (first item) when opened", () => {
    const { button, panel } = mount();
    button.click();
    expect(document.activeElement).toBe(panel.querySelector("button"));
  });
});

describe("menu contents", () => {
  it("renders the menu items in order: Game history, Score over time, User preferences, Leaderboard", () => {
    const { panel } = mount();
    const items = Array.from(panel.querySelectorAll("button")).map((b) => b.textContent);
    expect(items).toEqual(["Game history", "Score over time", "User preferences", "Leaderboard"]);
  });

  it("'Game history', 'Score over time', and 'User preferences' are enabled; only 'Leaderboard' is disabled", () => {
    const { panel } = mount();
    const [history, scoreView, preferences, leaderboard] = Array.from(panel.querySelectorAll("button"));
    expect(history.disabled).toBe(false);
    expect(scoreView.disabled).toBe(false);
    expect(preferences.disabled).toBe(false);
    expect(leaderboard.disabled).toBe(true);
  });

  it("clicking a disabled item does nothing (no click event fires at all)", () => {
    const { button, panel } = mount();
    button.click(); // open
    const leaderboard = Array.from(panel.querySelectorAll("button")).find(
      (b) => b.textContent === "Leaderboard",
    )!;
    const spy = vi.fn();
    leaderboard.addEventListener("click", spy);
    leaderboard.click();
    expect(spy).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(false); // still open — nothing happened
  });
});

describe("the integration points: onOpenHistory and onOpenScoreView", () => {
  it("clicking 'Game history' calls onOpenHistory and closes the menu", () => {
    const onOpenHistory = vi.fn();
    const { button, panel } = mount(onOpenHistory);
    button.click();

    const history = Array.from(panel.querySelectorAll("button")).find(
      (b) => b.textContent === "Game history",
    )!;
    history.click();

    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
  });

  it("clicking 'Score over time' calls onOpenScoreView and closes the menu", () => {
    const onOpenScoreView = vi.fn();
    const { button, panel } = mount(vi.fn(), onOpenScoreView);
    button.click();

    const scoreView = Array.from(panel.querySelectorAll("button")).find(
      (b) => b.textContent === "Score over time",
    )!;
    scoreView.click();

    expect(onOpenScoreView).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
  });

  it("clicking 'User preferences' calls onOpenPreferences and closes the menu", () => {
    const onOpenPreferences = vi.fn();
    const { button, panel } = mount(vi.fn(), vi.fn(), onOpenPreferences);
    button.click();

    const preferences = Array.from(panel.querySelectorAll("button")).find(
      (b) => b.textContent === "User preferences",
    )!;
    preferences.click();

    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
    expect(panel.hidden).toBe(true);
  });
});

describe("closing behavior", () => {
  it("clicking outside the menu closes it", () => {
    const { button, panel } = mount();
    button.click();
    expect(panel.hidden).toBe(false);

    document.body.click();
    expect(panel.hidden).toBe(true);
  });

  it("clicking inside the menu (but not on an item) does not close it", () => {
    const { button, panel } = mount();
    button.click();
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(panel.hidden).toBe(false);
  });

  it("Escape closes it and returns focus to the trigger button", () => {
    const { button, panel } = mount();
    button.click();
    expect(document.activeElement).not.toBe(button); // focus moved into the menu

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it("a key other than Escape does not close it", () => {
    const { button, panel } = mount();
    button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(panel.hidden).toBe(false);
  });

  it("Escape while already closed is a harmless no-op", () => {
    const { panel } = mount();
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    ).not.toThrow();
    expect(panel.hidden).toBe(true);
  });
});

describe("dispose", () => {
  it("removes the document-level listeners, so a stray click/Escape afterward does nothing", () => {
    const { menu, button, panel } = mount();
    button.click();
    expect(panel.hidden).toBe(false);

    menu.dispose();
    // Force it back open via the DOM directly (bypassing the now-detached
    // listeners) to prove a later outside click/Escape no longer reaches them.
    panel.hidden = false;
    document.body.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hidden).toBe(false); // untouched — dispose() really removed the listeners
  });
});
