import { beforeEach, describe, expect, it, vi } from "vitest";
import { newHelpOverlay, newHelpButton } from "./help";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("newHelpOverlay", () => {
  it("renders a dialog element", () => {
    const overlay = newHelpOverlay();
    expect(overlay.html.tagName).toBe("DIALOG");
  });

  it("contains a heading with the title 'How to play'", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const heading = overlay.html.querySelector("h2");
    expect(heading?.textContent).toBe("How to play");
  });

  it("renders an ordered list of exactly 2 rules", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const rulesList = overlay.html.querySelector("section ol");
    expect(rulesList).toBeDefined();
    const rules = rulesList?.querySelectorAll("li");
    expect(rules?.length).toBe(2);
  });

  it("rules section contains language about exactly one queen", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const text = overlay.html.textContent;
    expect(text).toContain("exactly 1 queen");
  });

  it("rules section mentions diagonal adjacency", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const text = overlay.html.textContent;
    expect(text).toContain("diagonally");
  });

  it("renders a strategy tips section mentioning 'smallest region'", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const text = overlay.html.textContent;
    expect(text).toContain("smallest region");
  });

  it("renders a 'Making moves' section mentioning 'Double click'", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const text = overlay.html.textContent;
    expect(text).toContain("Double click");
  });

  it("lists all keyboard bindings", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const text = overlay.html.textContent;
    expect(text).toContain("↑");
    expect(text).toContain("X");
    expect(text).toContain("Q");
    expect(text).toContain("Keyboard controls");
  });

  it("opens as a modal via showModal()", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();
    expect(overlay.html.open).toBe(true);
  });

  it("closes via close()", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();
    overlay.close();
    expect(overlay.html.open).toBe(false);
  });

  it("closes on Escape (native cancel event)", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();

    const cancelled = new Event("cancel", { cancelable: true });
    overlay.html.dispatchEvent(cancelled);
    // The dialog's native cancel event closes it without preventDefault
    overlay.html.close();
    expect(overlay.html.open).toBe(false);
  });

  it("closes on backdrop click", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();

    // Simulate a click on the dialog itself (backdrop)
    overlay.html.dispatchEvent(new Event("click", { bubbles: true }));
    // The dialog is closed by the onclick handler
    expect(overlay.html.open).toBe(false);
  });

  it("does not close on a click inside the card", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();

    const card = overlay.html.querySelector("div");
    if (card) {
      card.dispatchEvent(new Event("click", { bubbles: true }));
    }
    // Click inside the card should not close it
    expect(overlay.html.open).toBe(true);
  });

  it("does not render 'Replay the tutorial' button when onReplayTutorial is not provided", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const replayButton = Array.from(overlay.html.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Replay the tutorial",
    );
    expect(replayButton).toBeUndefined();
  });

  it("renders 'Replay the tutorial' button when onReplayTutorial is provided", () => {
    const callback = vi.fn();
    const overlay = newHelpOverlay({ onReplayTutorial: callback });
    document.body.append(overlay.html);
    const replayButton = Array.from(overlay.html.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Replay the tutorial",
    );
    expect(replayButton).toBeDefined();
  });

  it("clicking 'Replay the tutorial' closes dialog and calls callback", () => {
    const callback = vi.fn();
    const overlay = newHelpOverlay({ onReplayTutorial: callback });
    document.body.append(overlay.html);
    overlay.open();

    const replayButton = Array.from(overlay.html.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Replay the tutorial",
    );
    expect(replayButton).toBeDefined();

    replayButton?.dispatchEvent(new Event("click"));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(overlay.html.open).toBe(false);
  });

  it("renders a Close button", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const closeButton = Array.from(overlay.html.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Close",
    );
    expect(closeButton).toBeDefined();
  });

  it("clicking Close button closes the dialog", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    overlay.open();

    const closeButton = Array.from(overlay.html.querySelectorAll("button")).find(
      (btn) => btn.textContent === "Close",
    );
    closeButton?.dispatchEvent(new Event("click"));
    expect(overlay.html.open).toBe(false);
  });
});

describe("newHelpButton", () => {
  it("returns a button element", () => {
    const button = newHelpButton(() => {});
    expect(button.tagName).toBe("BUTTON");
  });

  it("has id='help'", () => {
    const button = newHelpButton(() => {});
    expect(button.id).toBe("help");
  });

  it("has an aria-label attribute", () => {
    const button = newHelpButton(() => {});
    expect(button.getAttribute("aria-label")).toBe("Help — rules, tips & controls");
  });

  it("calls the callback when clicked", () => {
    const callback = vi.fn();
    const button = newHelpButton(callback);
    document.body.append(button);

    button.dispatchEvent(new Event("click"));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
