import { describe, expect, it, vi } from "vitest";
import { newStartOverButton } from "./startover";

describe("newStartOverButton", () => {
  it("renders a labeled button", () => {
    const button = newStartOverButton({ onConfirm: vi.fn() });
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Start over");
  });

  it("calls onConfirm when the injected confirm returns true", () => {
    const onConfirm = vi.fn();
    const confirm = vi.fn().mockReturnValue(true);
    const button = newStartOverButton({ onConfirm, confirm });

    button.click();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm when the injected confirm returns false", () => {
    const onConfirm = vi.fn();
    const confirm = vi.fn().mockReturnValue(false);
    const button = newStartOverButton({ onConfirm, confirm });

    button.click();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("passes a real, non-empty confirmation message", () => {
    const confirm = vi.fn().mockReturnValue(false);
    const button = newStartOverButton({ onConfirm: vi.fn(), confirm });

    button.click();

    const [message] = confirm.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("re-confirms on every click — a cancelled attempt doesn't silently allow the next click through", () => {
    const onConfirm = vi.fn();
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const button = newStartOverButton({ onConfirm, confirm });

    button.click();
    expect(onConfirm).not.toHaveBeenCalled();

    button.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("defaults to window.confirm when none is injected", () => {
    // happy-dom doesn't implement window.confirm itself, so a plain
    // vi.spyOn would fail with "can only spy on a function" — stub it first.
    window.confirm = () => true;
    const spy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onConfirm = vi.fn();
    const button = newStartOverButton({ onConfirm });

    button.click();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
