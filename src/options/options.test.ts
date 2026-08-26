import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SIZE, MIN_SIZE } from "../board/generate";
import { newOptions } from "./options";

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

describe("submitting", () => {
  it("reports the chosen size", () => {
    const onSubmit = vi.fn();
    const { input, form } = mount({ onSubmit });
    input.value = "12";
    submit(form);
    expect(onSubmit).toHaveBeenCalledWith(12);
  });

  it("accepts both ends of the range", () => {
    for (const size of [MIN_SIZE, MAX_SIZE]) {
      const onSubmit = vi.fn();
      const { input, form } = mount({ onSubmit });
      input.value = String(size);
      submit(form);
      expect(onSubmit).toHaveBeenCalledWith(size);
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
