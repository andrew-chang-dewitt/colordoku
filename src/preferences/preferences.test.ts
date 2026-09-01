import { describe, it, expect, beforeEach, vi } from "vitest";
import { newPreferences } from "./preferences";

describe("preferences drawer", () => {
  beforeEach(() => {
    // Clear any dialog instances between tests
    document.querySelectorAll("dialog").forEach((d) => d.remove());
  });

  it("renders with checkbox reflecting initial state", () => {
    const prefs = newPreferences({ initial: { version: 1, autoEliminate: true } });
    const checkbox = prefs.html.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("defaults to unchecked when no initial state", () => {
    const prefs = newPreferences();
    const checkbox = prefs.html.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("calls onChange when checkbox is toggled", () => {
    const onChange = vi.fn();
    const prefs = newPreferences({ initial: { version: 1, autoEliminate: false }, onChange });
    const checkbox = prefs.html.querySelector('input[type="checkbox"]') as HTMLInputElement;

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith({ autoEliminate: true });

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith({ autoEliminate: false });
  });

  it("open/close toggle html.open", () => {
    const prefs = newPreferences();
    document.body.append(prefs.html);

    expect(prefs.html.open).toBe(false);
    prefs.open();
    expect(prefs.html.open).toBe(true);
    prefs.close();
    expect(prefs.html.open).toBe(false);
  });

  it("close button closes the dialog", () => {
    const prefs = newPreferences();
    document.body.append(prefs.html);

    prefs.open();
    const closeButton = prefs.html.querySelector("button") as HTMLButtonElement;
    closeButton.click();
    expect(prefs.html.open).toBe(false);
  });

  it("backdrop click closes the dialog", () => {
    const prefs = newPreferences();
    document.body.append(prefs.html);

    prefs.open();
    const event = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: prefs.html, enumerable: true });
    prefs.html.dispatchEvent(event);
    expect(prefs.html.open).toBe(false);
  });

  it("Escape closes the dialog", () => {
    const prefs = newPreferences();
    document.body.append(prefs.html);

    prefs.open();
    const event = new KeyboardEvent("keydown", { key: "Escape" });
    prefs.html.dispatchEvent(event);
    expect(prefs.html.open).toBe(false);
  });

  it("get() returns live state", () => {
    const prefs = newPreferences({ initial: { version: 1, autoEliminate: false } });
    const checkbox = prefs.html.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(prefs.get()).toEqual({ autoEliminate: false });
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(prefs.get()).toEqual({ autoEliminate: true });
  });

  it("moves focus to the Done button on open", () => {
    const prefs = newPreferences();
    document.body.append(prefs.html);
    prefs.open();
    const doneButton = prefs.html.querySelector("button") as HTMLButtonElement;
    expect(document.activeElement).toBe(doneButton);
  });
});
