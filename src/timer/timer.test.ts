import { describe, expect, it } from "vitest";
import { formatElapsed } from "./timer";

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
