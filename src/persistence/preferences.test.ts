import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadPreferences, savePreferences } from "./preferences";

describe("preferences", () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key: string) => storage[key] ?? null,
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (key: string, value: string) => {
        storage[key] = value;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads defaults when localStorage is empty", () => {
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
  });

  it("round-trips a saved preference", () => {
    savePreferences({ autoEliminate: true });
    const prefs = loadPreferences();
    expect(prefs.autoEliminate).toBe(true);
  });

  it("falls back to defaults when JSON is malformed", () => {
    storage["colordoku:preferences"] = "not valid json";
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
  });

  it("falls back to defaults when version is wrong", () => {
    storage["colordoku:preferences"] = JSON.stringify({
      version: 2,
      autoEliminate: true,
    });
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
  });

  it("falls back to defaults when autoEliminate is not a boolean", () => {
    storage["colordoku:preferences"] = JSON.stringify({
      version: 1,
      autoEliminate: "yes",
    });
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
  });

  it("falls back to defaults for non-object value", () => {
    storage["colordoku:preferences"] = JSON.stringify(null);
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
  });

  it("swallows localStorage.setItem errors", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    expect(() => savePreferences({ autoEliminate: true })).not.toThrow();
    setItemSpy.mockRestore();
  });

  it("swallows localStorage.getItem errors", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      version: 1,
      autoEliminate: false,
    });
    getItemSpy.mockRestore();
  });
});
