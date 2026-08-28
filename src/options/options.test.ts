import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SIZE, MIN_SIZE } from "../board/generate";
import { newOptions, startOver, goToSize } from "./options";
import * as persistence from "../persistence/persistence";
import * as history from "../persistence/history";

function mount(config: Parameters<typeof newOptions>[0] = {}) {
  const options = newOptions(config);
  document.body.append(options.html);
  const input = options.html.querySelector("input")!;
  const form = options.html.querySelector("form")!;
  return { options, input, form };
}

/** Bypasses native constraint validation to reach the submit handler directly. */
function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the size field", () => {
  it("constrains input to the supported range", () => {
    const { input } = mount();
    expect(input.type).toBe("number");
    expect(input.min).toBe(String(MIN_SIZE));
    expect(input.max).toBe(String(MAX_SIZE));
    expect(input.required).toBe(true);
  });

  it("pre-fills the current size", () => {
    expect(mount({ size: 11 }).input.value).toBe("11");
  });

  it("clamps a pre-filled size that is out of range", () => {
    expect(mount({ size: 99 }).input.value).toBe(String(MAX_SIZE));
    expect(mount({ size: 2 }).input.value).toBe(String(MIN_SIZE));
  });
});

describe("the difficulty field (UI only — not wired to any game behavior yet)", () => {
  function radios(html: HTMLElement): HTMLInputElement[] {
    return Array.from(html.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  }

  it("renders exactly three mutually-exclusive options: easy, medium, hard", () => {
    const { options } = mount();
    const buttons = radios(options.html);
    expect(buttons).toHaveLength(3);
    expect(buttons.map((r) => r.value)).toEqual(["easy", "medium", "hard"]);
    // Same `name` on all three is what makes them mutually exclusive as a
    // native radio group, independent of any JS.
    expect(new Set(buttons.map((r) => r.name))).toEqual(new Set(["difficulty"]));
  });

  it("defaults to medium selected", () => {
    const { options } = mount();
    const checked = radios(options.html).find((r) => r.checked);
    expect(checked?.value).toBe("medium");
    // Exactly one is checked, not zero or more than one.
    expect(radios(options.html).filter((r) => r.checked)).toHaveLength(1);
  });

  it("pre-selects the configured difficulty instead of the default", () => {
    const { options } = mount({ difficulty: "hard" });
    const checked = radios(options.html).find((r) => r.checked);
    expect(checked?.value).toBe("hard");
  });

  it("is grouped under a fieldset/legend, not just a plain label (a label pairs with one control; three radios need a group heading)", () => {
    const { options } = mount();
    const fieldset = options.html.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect(fieldset?.querySelector("legend")?.textContent).toBe("Difficulty");
  });

  it("is keyboard-accessible: every radio has an associated label via id/for, so clicking or activating the label toggles its radio", () => {
    const { options } = mount();
    for (const radio of radios(options.html)) {
      expect(radio.id).not.toBe("");
      const label = options.html.querySelector<HTMLLabelElement>(`label[for="${radio.id}"]`);
      expect(label, `radio ${radio.value} should have a matching label`).not.toBeNull();
    }
  });

  it("choosing a different option moves the checked state (still a real, individually focusable native radio group)", () => {
    const { options } = mount();
    const [easy, , hard] = radios(options.html);
    expect(easy.checked).toBe(false);

    hard.click();
    expect(hard.checked).toBe(true);

    easy.click();
    expect(easy.checked).toBe(true);
    expect(hard.checked).toBe(false); // native radio-group exclusivity
  });

  it("submits whichever difficulty is actually selected, alongside the size", () => {
    const onSubmit = vi.fn();
    const { options, input, form } = mount({ onSubmit });
    radios(options.html).find((r) => r.value === "hard")!.click();
    input.value = "10";
    submit(form);
    expect(onSubmit).toHaveBeenCalledWith(10, "hard");
  });

  it("submits the pre-filled default difficulty when the player never touches the radios", () => {
    const onSubmit = vi.fn();
    const { input, form } = mount({ onSubmit, difficulty: "easy" });
    input.value = "10";
    submit(form);
    expect(onSubmit).toHaveBeenCalledWith(10, "easy");
  });
});

describe("submitting", () => {
  it("reports the chosen size", () => {
    const onSubmit = vi.fn();
    const { input, form } = mount({ onSubmit });
    input.value = "12";
    submit(form);
    expect(onSubmit).toHaveBeenCalledWith(12, "medium");
  });

  it("accepts both ends of the range", () => {
    for (const size of [MIN_SIZE, MAX_SIZE]) {
      const onSubmit = vi.fn();
      const { input, form } = mount({ onSubmit });
      input.value = String(size);
      submit(form);
      expect(onSubmit).toHaveBeenCalledWith(size, "medium");
    }
  });

  it("refuses sizes outside the range", () => {
    for (const bad of [String(MIN_SIZE - 1), String(MAX_SIZE + 1), "0", "-5"]) {
      const onSubmit = vi.fn();
      const { input, form } = mount({ onSubmit });
      input.value = bad;
      submit(form);
      expect(onSubmit, `size ${bad} should be rejected`).not.toHaveBeenCalled();
    }
  });

  it("refuses non-integers and empty input", () => {
    for (const bad of ["", "abc", "7.5"]) {
      const onSubmit = vi.fn();
      const { input, form } = mount({ onSubmit });
      input.value = bad;
      submit(form);
      expect(onSubmit, `"${bad}" should be rejected`).not.toHaveBeenCalled();
    }
  });

  it("never reloads the page itself", () => {
    const onSubmit = vi.fn();
    const { input, form } = mount({ onSubmit });
    input.value = "8";
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("opening and closing", () => {
  it("opens as a modal so the board behind it is inert", () => {
    const { options } = mount();
    options.open();
    expect(options.html.open).toBe(true);
  });

  it("can be dismissed when a board is already showing", () => {
    const { options } = mount();
    options.open({ dismissable: true });

    const cancelled = new Event("cancel", { cancelable: true });
    options.html.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(false);

    options.close();
    expect(options.html.open).toBe(false);
  });

  it("refuses to be dismissed when there is no board behind it", () => {
    const { options } = mount();
    options.open({ dismissable: false });

    const cancelled = new Event("cancel", { cancelable: true });
    options.html.dispatchEvent(cancelled);
    expect(cancelled.defaultPrevented).toBe(true);
    expect(options.html.open).toBe(true);
  });

  it("hides the cancel button only when non-dismissable", () => {
    const { options } = mount();
    const cancel = options.html.querySelector<HTMLButtonElement>("button[type=button]")!;

    options.open({ dismissable: false });
    expect(cancel.hidden).toBe(true);

    options.close();
    options.open({ dismissable: true });
    expect(cancel.hidden).toBe(false);
  });

  it("closes on a backdrop click but not on a click inside the form", () => {
    const { options, form } = mount();

    options.open({ dismissable: true });
    form.dispatchEvent(new Event("click", { bubbles: true }));
    expect(options.html.open, "a click inside the form should not close it").toBe(true);

    options.html.dispatchEvent(new Event("click", { bubbles: true }));
    expect(options.html.open).toBe(false);
  });

  it("ignores backdrop clicks when non-dismissable", () => {
    const { options } = mount();
    options.open({ dismissable: false });
    options.html.dispatchEvent(new Event("click", { bubbles: true }));
    expect(options.html.open).toBe(true);
  });
});

describe("startOver", () => {
  // startOver navigates via location.assign, same as goToSize — real
  // navigation isn't exercised by unit tests (see the real-browser
  // Playwright check for that); this verifies the actual side effects it's
  // responsible for composing, in the right order.
  it("closes out any in-progress history entry, abandons the saved game, and navigates to the same board's size + board-id, in that order", () => {
    const closeOutSpy = vi.spyOn(history, "closeOutInProgress").mockImplementation(() => {});
    const abandonSpy = vi.spyOn(persistence, "abandonGame").mockImplementation(() => {});
    const assignSpy = vi.spyOn(location, "assign").mockImplementation(() => {});

    const order: string[] = [];
    closeOutSpy.mockImplementation(() => order.push("closeOut"));
    abandonSpy.mockImplementation(() => order.push("abandon"));
    assignSpy.mockImplementation(() => order.push("navigate"));

    startOver(8, 424242, "hard");

    expect(order).toEqual(["closeOut", "abandon", "navigate"]);
    expect(assignSpy).toHaveBeenCalledWith("?size=8&board-id=424242&difficulty=hard");

    closeOutSpy.mockRestore();
    abandonSpy.mockRestore();
    assignSpy.mockRestore();
  });

  it("keeps the exact same seed across the navigation (the whole point vs. goToSize)", () => {
    vi.spyOn(history, "closeOutInProgress").mockImplementation(() => {});
    vi.spyOn(persistence, "abandonGame").mockImplementation(() => {});
    const assignSpy = vi.spyOn(location, "assign").mockImplementation(() => {});

    startOver(12, 7, "easy");

    expect(assignSpy).toHaveBeenCalledWith("?size=12&board-id=7&difficulty=easy");

    vi.restoreAllMocks();
  });
});

describe("goToSize", () => {
  it("closes out any in-progress history entry, abandons the saved game, and navigates to the chosen size + difficulty", () => {
    const closeOutSpy = vi.spyOn(history, "closeOutInProgress").mockImplementation(() => {});
    const abandonSpy = vi.spyOn(persistence, "abandonGame").mockImplementation(() => {});
    const assignSpy = vi.spyOn(location, "assign").mockImplementation(() => {});

    const order: string[] = [];
    closeOutSpy.mockImplementation(() => order.push("closeOut"));
    abandonSpy.mockImplementation(() => order.push("abandon"));
    assignSpy.mockImplementation(() => order.push("navigate"));

    goToSize(8, "hard");

    expect(order).toEqual(["closeOut", "abandon", "navigate"]);
    expect(assignSpy).toHaveBeenCalledWith("?size=8&difficulty=hard");

    vi.restoreAllMocks();
  });
});
