import classes from "./options.module.css";
import { MAX_SIZE, MIN_SIZE } from "../board/generate";

const DEFAULT_SIZE = 8;

export interface Options {
  html: HTMLDialogElement;
  /**
   * Slide the drawer up. Non-dismissable when the page has no board behind it —
   * there is nothing to go back to, so Escape and backdrop clicks are ignored.
   */
  open: (opts?: { dismissable?: boolean }) => void;
  close: () => void;
}

export interface OptionsConfig {
  /** Pre-filled board size. */
  size?: number;
  /** Defaults to navigating to `?size=N`. Injectable so tests need no navigation. */
  onSubmit?: (size: number) => void;
}

/** Load a fresh board at the chosen size, dropping any `?seed=` from the URL. */
export function goToSize(size: number): void {
  location.assign(`?size=${size}`);
}

function clampToRange(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

export function newOptions({
  size = DEFAULT_SIZE,
  onSubmit = goToSize,
}: OptionsConfig = {}): Options {
  let dismissable = true;

  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const form = document.createElement("form");
  form.className = classes.form;

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  heading.textContent = "New game";
  form.append(heading);

  const sizeId = "options-size";
  const label = document.createElement("label");
  label.className = classes.label;
  label.htmlFor = sizeId;
  label.textContent = "Board size";
  form.append(label);

  const input = document.createElement("input");
  input.id = sizeId;
  input.name = "size";
  input.type = "number";
  input.min = String(MIN_SIZE);
  input.max = String(MAX_SIZE);
  input.step = "1";
  input.required = true;
  input.value = String(clampToRange(size));
  input.className = classes.input;
  form.append(input);

  const hint = document.createElement("p");
  hint.className = classes.hint;
  hint.textContent = `${MIN_SIZE} to ${MAX_SIZE} cells a side. Larger boards take longer to generate.`;
  form.append(hint);

  // TODO: add difficulty selection here

  const actions = document.createElement("div");
  actions.className = classes.actions;

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = `btn btn-secondary ${classes.cancel}`;
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => html.close());
  actions.append(cancel);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-primary";
  submit.textContent = "Go!";
  actions.append(submit);

  form.append(actions);
  html.append(form);

  form.addEventListener("submit", (event) => {
    // The browser's own constraint validation already blocks an out-of-range
    // submit, but re-check: nothing else guarantees the value is in range.
    event.preventDefault();

    const value = Number(input.value);
    if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) {
      input.reportValidity();
      return;
    }

    onSubmit(value);
  });

  html.addEventListener("cancel", (event) => {
    if (!dismissable) event.preventDefault();
  });

  html.addEventListener("click", (event) => {
    // The dialog has no padding of its own, so the form covers its whole box —
    // a click landing on the dialog itself came from the backdrop.
    if (dismissable && event.target === html) html.close();
  });

  return {
    html,

    open({ dismissable: allowDismiss = true } = {}) {
      dismissable = allowDismiss;
      cancel.hidden = !allowDismiss;
      if (!html.open) html.showModal();
      input.focus();
      input.select();
    },

    close() {
      html.close();
    },
  };
}
