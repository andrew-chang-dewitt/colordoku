import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElapsed, newTimer } from "./timer";

/** Mocks document.hidden and fires visibilitychange, mirroring what the browser does. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("formatElapsed", () => {
  it("formats zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("floors partial seconds rather than rounding", () => {
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1000)).toBe("0:01");
    expect(formatElapsed(1999)).toBe("0:01");
  });

  it("pads seconds under 10 with a leading zero", () => {
    expect(formatElapsed(5_000)).toBe("0:05");
  });

  it("rolls seconds over into minutes", () => {
    expect(formatElapsed(65_400)).toBe("1:05");
    expect(formatElapsed(60_000)).toBe("1:00");
  });

  it("does not pad minutes", () => {
    expect(formatElapsed(10 * 60_000)).toBe("10:00");
  });

  it("never goes negative", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

describe("newTimer visibility pause", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not advance elapsedMs while the tab is hidden", () => {
    const timer = newTimer();
    timer.start();

    vi.advanceTimersByTime(1_000);
    expect(timer.elapsedMs()).toBeGreaterThanOrEqual(1_000);

    setHidden(true);
    const elapsedWhenHidden = timer.elapsedMs();
    vi.advanceTimersByTime(5_000);
    // elapsedMs is Date.now() - startedAt, so it would naturally keep
    // climbing with real time; pausing must freeze it despite that.
    expect(timer.elapsedMs()).toBe(elapsedWhenHidden);

    timer.dispose();
  });

  it("resumes counting from where it left off once visible again", () => {
    const timer = newTimer();
    timer.start();

    vi.advanceTimersByTime(1_000);
    setHidden(true);
    vi.advanceTimersByTime(5_000); // time hidden should not count
    setHidden(false);
    vi.advanceTimersByTime(1_000);

    // ~1s before hiding + ~1s after resuming, not 7s.
    expect(timer.elapsedMs()).toBeGreaterThanOrEqual(2_000);
    expect(timer.elapsedMs()).toBeLessThan(3_000);

    timer.dispose();
  });

  it("is a no-op if the tab hides before start() is ever called", () => {
    const timer = newTimer();
    setHidden(true);
    setHidden(false);
    expect(timer.elapsedMs()).toBe(0);
    timer.dispose();
  });

  it("does not resume a timer already stopped (e.g. game already ended)", () => {
    const timer = newTimer();
    timer.start();
    vi.advanceTimersByTime(1_000);
    timer.stop();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    setHidden(true);
    setHidden(false);
    vi.advanceTimersByTime(5_000);

    // A stray visibilitychange after stop() must not restart the render
    // interval — stop() is meant to be final (game already ended).
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    timer.dispose();
  });
});

describe("newTimer restore (used to re-hydrate a saved game after reload)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("displays the restored value immediately, before any tick", () => {
    const timer = newTimer();
    timer.restore(65_000, true);
    expect(timer.html.textContent).toBe(formatElapsed(65_000));
    timer.dispose();
  });

  it("keeps counting up from the restored value when running is true", () => {
    const timer = newTimer();
    timer.restore(5_000, true);
    vi.advanceTimersByTime(2_000);
    expect(timer.elapsedMs()).toBeGreaterThanOrEqual(7_000);
    expect(timer.elapsedMs()).toBeLessThan(8_000);
    timer.dispose();
  });

  it("stays frozen at the restored value when running is false", () => {
    const timer = newTimer();
    timer.restore(5_000, false);
    vi.advanceTimersByTime(3_000);
    expect(timer.elapsedMs()).toBe(5_000);
    timer.dispose();
  });

  it("a restored-stopped timer still ignores a stray visibilitychange", () => {
    const timer = newTimer();
    timer.restore(5_000, false);

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    setHidden(true);
    setHidden(false);
    vi.advanceTimersByTime(2_000);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(timer.elapsedMs()).toBe(5_000);

    setIntervalSpy.mockRestore();
    timer.dispose();
  });

  it("a restored-running timer still pauses correctly while hidden", () => {
    const timer = newTimer();
    timer.restore(5_000, true);

    setHidden(true);
    vi.advanceTimersByTime(3_000);
    expect(timer.elapsedMs()).toBe(5_000);

    setHidden(false);
    vi.advanceTimersByTime(1_000);
    expect(timer.elapsedMs()).toBeGreaterThanOrEqual(6_000);
    expect(timer.elapsedMs()).toBeLessThan(7_000);

    timer.dispose();
  });
});
