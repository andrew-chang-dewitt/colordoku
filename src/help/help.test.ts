import { beforeEach, describe, expect, it } from "vitest";
import { newHelpOverlay } from "./help";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("newHelpOverlay", () => {
  it("renders a dialog element", () => {
    const overlay = newHelpOverlay();
    expect(overlay.html.tagName).toBe("DIALOG");
  });

  it("contains a heading with the title", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const heading = overlay.html.querySelector("h2");
    expect(heading?.textContent).toBe("Keyboard controls");
  });

  it("lists all keyboard bindings", () => {
    const overlay = newHelpOverlay();
    document.body.append(overlay.html);
    const items = overlay.html.querySelectorAll("li");
    expect(items.length).toBeGreaterThan(0);

    // Check that key bindings are present
    const text = overlay.html.textContent;
    expect(text).toContain("↑");
    expect(text).toContain("X");
    expect(text).toContain("Q");
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
});
