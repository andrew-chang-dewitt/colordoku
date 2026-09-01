import classes from "./preferences.module.css";
import type { UserPreferences } from "../persistence/preferences";
import { savePreferences } from "../persistence/preferences";

const DEFAULTS: Omit<UserPreferences, "version"> = { autoEliminate: false };

export interface PreferencesConfig {
  initial?: UserPreferences;
  onChange?: (prefs: Omit<UserPreferences, "version">) => void;
}

export interface Preferences {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
  /** Live read of the current in-memory value — what board.ts's isEnabled thunk reads. */
  get: () => Omit<UserPreferences, "version">;
}

export function newPreferences({
  initial,
  onChange = savePreferences,
}: PreferencesConfig = {}): Preferences {
  const state = { ...DEFAULTS, ...(initial ? { autoEliminate: initial.autoEliminate } : {}) };

  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const form = document.createElement("form");
  form.className = classes.panel;
  const heading = document.createElement("h2");
  heading.textContent = "Preferences";
  heading.className = classes.heading;
  form.append(heading);

  const field = document.createElement("div");
  field.className = classes.field;

  const checkboxId = "pref-auto-eliminate";
  const label = document.createElement("label");
  label.htmlFor = checkboxId;
  label.textContent = "Auto-eliminate cells when a queen is found";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = checkboxId;
  checkbox.checked = state.autoEliminate;

  function updateState(): void {
    state.autoEliminate = checkbox.checked;
    onChange(state);
  }

  checkbox.addEventListener("change", updateState);
  // Also listen to input for immediate feedback in browsers
  checkbox.addEventListener("input", updateState);
  field.append(checkbox, label);
  form.append(field);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-primary";
  close.textContent = "Done";
  close.addEventListener("click", () => html.close());
  form.append(close);

  html.append(form);

  // Dismissable: Escape and backdrop click both close it — there's always a
  // board behind it, unlike options.ts's non-dismissable first-load case, so
  // preferences never needs that mode.
  html.addEventListener("click", (event) => {
    if (event.target === html) html.close();
  });

  // Explicit Escape handling for test environment compatibility
  html.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      html.close();
    }
  });

  return {
    html,
    open: () => {
      if (!html.open) {
        html.showModal();
        close.focus();
      }
    },
    close: () => html.close(),
    get: () => ({ ...state }),
  };
}
