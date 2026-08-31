import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearTutorial,
  hasSeenTutorial,
  loadTutorial,
  markTutorialCompleted,
  markTutorialProgress,
  markTutorialSkipped,
  markTutorialStarted,
  type TutorialRecord,
} from "./tutorial";

describe("tutorial.ts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts unseen (no stored record)", () => {
    expect(loadTutorial()).toBe(null);
    expect(hasSeenTutorial()).toBe(false);
  });

  it("markTutorialStarted writes immediately", () => {
    markTutorialStarted();
    const record = loadTutorial();
    expect(record).not.toBeNull();
    expect(record!.status).toBe("started");
    expect(record!.step).toBe(0);
    expect(record!.completedAt).toBe(null);
  });

  it("markTutorialProgress updates the step without changing status", () => {
    markTutorialStarted();
    markTutorialProgress(5);
    const record = loadTutorial();
    expect(record!.status).toBe("started");
    expect(record!.step).toBe(5);
  });

  it("markTutorialSkipped sets status to 'skipped'", () => {
    markTutorialStarted();
    markTutorialSkipped(3);
    const record = loadTutorial();
    expect(record!.status).toBe("skipped");
    expect(record!.step).toBe(3);
  });

  it("markTutorialCompleted sets status to 'completed' and latches completedAt", () => {
    markTutorialStarted();
    markTutorialProgress(14);
    markTutorialCompleted(14);

    const record = loadTutorial();
    expect(record!.status).toBe("completed");
    expect(record!.completedAt).not.toBeNull();
  });

  it("completedAt latches across a later skip", () => {
    markTutorialStarted();
    markTutorialCompleted(14);
    const firstCompletion = loadTutorial()!.completedAt;

    // Simulate a replay: skip this time
    markTutorialSkipped(5);
    const recordAfterSkip = loadTutorial();

    expect(recordAfterSkip!.completedAt).toBe(firstCompletion);
    expect(recordAfterSkip!.status).toBe("skipped");
  });

  it("hasSeenTutorial is true after marking started", () => {
    markTutorialStarted();
    expect(hasSeenTutorial()).toBe(true);
  });

  it("hasSeenTutorial is true after skipping", () => {
    markTutorialStarted();
    markTutorialSkipped(0);
    expect(hasSeenTutorial()).toBe(true);
  });

  it("hasSeenTutorial is true after completing", () => {
    markTutorialStarted();
    markTutorialCompleted(14);
    expect(hasSeenTutorial()).toBe(true);
  });

  it("clearTutorial removes the stored record", () => {
    markTutorialStarted();
    clearTutorial();
    expect(loadTutorial()).toBe(null);
    expect(hasSeenTutorial()).toBe(false);
  });

  it("corrupt JSON is treated as unseen", () => {
    localStorage.setItem("colordoku:tutorial", "{invalid json");
    expect(loadTutorial()).toBe(null);
  });

  it("wrong version is treated as unseen", () => {
    const record: TutorialRecord = {
      version: 1,
      status: "started",
      step: 0,
      updatedAt: Date.now(),
      completedAt: null,
    };
    localStorage.setItem("colordoku:tutorial", JSON.stringify({ ...record, version: 0 }));
    expect(loadTutorial()).toBe(null);
  });

  it("wrong status enum is treated as unseen", () => {
    const record: TutorialRecord = {
      version: 1,
      status: "started",
      step: 0,
      updatedAt: Date.now(),
      completedAt: null,
    };
    localStorage.setItem("colordoku:tutorial", JSON.stringify({ ...record, status: "invalid" }));
    expect(loadTutorial()).toBe(null);
  });

  it("missing required fields is treated as unseen", () => {
    localStorage.setItem("colordoku:tutorial", JSON.stringify({ version: 1 }));
    expect(loadTutorial()).toBe(null);
  });

  it("throws from localStorage do not propagate", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    spy.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => markTutorialStarted()).not.toThrow();
    expect(() => markTutorialProgress(1)).not.toThrow();
    expect(() => markTutorialSkipped(1)).not.toThrow();
    expect(() => markTutorialCompleted(1)).not.toThrow();
    expect(() => clearTutorial()).not.toThrow();

    spy.mockRestore();
  });

  it("round-trips all field values", () => {
    const now = Date.now();

    // Start
    markTutorialStarted();
    let record = loadTutorial()!;
    expect(record.version).toBe(1);
    expect(record.status).toBe("started");
    expect(record.step).toBe(0);
    expect(record.updatedAt).toBeGreaterThanOrEqual(now);
    expect(record.completedAt).toBe(null);

    // Progress
    markTutorialProgress(5);
    record = loadTutorial()!;
    expect(record.step).toBe(5);
    expect(record.status).toBe("started");

    // Complete
    markTutorialCompleted(14);
    record = loadTutorial()!;
    expect(record.status).toBe("completed");
    expect(record.step).toBe(14);
    expect(record.completedAt).not.toBeNull();

    const completedAt = record.completedAt;

    // Replay: skip
    markTutorialSkipped(3);
    record = loadTutorial()!;
    expect(record.status).toBe("skipped");
    expect(record.step).toBe(3);
    expect(record.completedAt).toBe(completedAt); // latched
  });
});
