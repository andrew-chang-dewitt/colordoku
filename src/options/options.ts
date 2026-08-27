import classes from "./options.module.css";
import { MAX_SIZE, MIN_SIZE } from "../board/generate";
import { abandonGame } from "../persistence/persistence";
import { closeOutInProgress } from "../persistence/history";

const DEFAULT_SIZE = 8;

export type Difficulty = "easy" | "medium" | "hard";
const DEFAULT_DIFFICULTY: Difficulty = "medium";
const DIFFICULTIES: ReadonlyArray<{ value: Difficulty; label: string }> = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

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
  /**
   * Pre-filled difficulty. UI-only for now — the radio group here has no
   * effect on generation or gameplay yet (see the field's own comment in
   * newOptions() below), so this only controls which option starts selected.
   */
  difficulty?: Difficulty;
  /** Defaults to navigating to `?size=N`. Injectable so tests need no navigation. */
  onSubmit?: (size: number) => void;
}

/**
 * Load a fresh board at the chosen size, dropping any `?board-id=` from the
 * URL. This is one of two choke points "start a new game" paths go through —
 * this one for a genuinely different board (the options drawer's submit, and
 * gameover's "New game, same size", which picks a fresh random seed at the
 * same size) — see startOver() below for the sibling choke point that keeps
 * the same board instead. Both are where a previously-saved in-progress game
 * is discarded — the player has explicitly chosen to abandon it.
 * Uses abandonGame(), not a plain clearGame(): the old page's own
 * `beforeunload` persist handler still fires during the navigation below,
 * after this line runs, and would otherwise silently re-save the very game
 * just cleared (see abandonGame's doc comment).
 *
 * closeOutInProgress() runs first, while the about-to-be-cleared SavedGame
 * is still readable, so a genuinely-in-progress attempt is finalized as
 * "abandoned" in history rather than left stuck as "playing" forever (see
 * that function's doc comment in persistence/history.ts).
 */
export function goToSize(size: number): void {
  closeOutInProgress();
  abandonGame();
  location.assign(`?size=${size}`);
}

/**
 * Resets progress on the *same* board — same size and seed — instead of
 * picking a different one. Used by the "Start over" button (see
 * src/startover/startover.ts for the confirm-gated button itself; this
 * function is the actual abandon-then-navigate side effect, kept here next
 * to goToSize since it's the same shape for the same reason).
 *
 * Passing `?board-id=` (rather than omitting it, as goToSize does) is what
 * keeps the board identical: src/board/generate.ts's generateCells always
 * resolves an explicit seed through exactly one worker, deterministically —
 * see its doc comment — so the freshly-generated board after this
 * navigation has the exact same region/queen layout as the one just
 * abandoned, just with progress reset to empty.
 *
 * Reusing goToSize's exact abandon-then-navigate shape (closeOutInProgress
 * before abandonGame, both before the navigation) is deliberate: a full page
 * navigation is what lets this reuse main.ts's entire existing
 * generate-and-mount path for free, with no separate in-place reset/cleanup
 * logic to get right — main.ts already knows how to boot a board from
 * `?size=`+`?board-id=` correctly. See goToSize's doc comment for why
 * closeOutInProgress() must run first, and abandonGame() before navigating.
 */
export function startOver(size: number, seed: number): void {
  closeOutInProgress();
  abandonGame();
  location.assign(`?size=${size}&board-id=${seed}`);
}

function clampToRange(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

export function newOptions({
  size = DEFAULT_SIZE,
  difficulty = DEFAULT_DIFFICULTY,
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

  const sizeField = document.createElement("div");
  sizeField.className = classes.field;

  const sizeId = "options-size";
  const label = document.createElement("label");
  label.className = classes.label;
  label.htmlFor = sizeId;
  label.textContent = "Board size";
  sizeField.append(label);

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
  sizeField.append(input);

  const hint = document.createElement("p");
  hint.className = classes.hint;
  hint.textContent = `${MIN_SIZE} to ${MAX_SIZE} cells a side. Larger boards take longer to generate.`;
  sizeField.append(hint);

  form.append(sizeField);

  // Difficulty selector: UI only, per the product call on this pass — there
  // is deliberately no behavior wired to it yet (maxGuessesFor() in
  // board.ts still drives guesses-per-board on its own, untouched). This
  // just gets the control in place, styled, with a sensible default
  // ("medium") — a future pass connects it to actual generation/gameplay.
  const difficultyField = document.createElement("fieldset");
  difficultyField.className = classes.difficulty;

  const legend = document.createElement("legend");
  legend.className = classes.legend;
  legend.textContent = "Difficulty";
  difficultyField.append(legend);

  const difficultyOptions = document.createElement("div");
  difficultyOptions.className = classes.difficultyOptions;

  for (const { value, label: optionLabel } of DIFFICULTIES) {
    const optionId = `options-difficulty-${value}`;

    const choice = document.createElement("div");
    choice.className = classes.choice;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.id = optionId;
    radio.name = "difficulty";
    radio.value = value;
    radio.checked = value === difficulty;
    choice.append(radio);

    const choiceLabel = document.createElement("label");
    choiceLabel.htmlFor = optionId;
    choiceLabel.textContent = optionLabel;
    choice.append(choiceLabel);

    difficultyOptions.append(choice);
  }

  difficultyField.append(difficultyOptions);
  form.append(difficultyField);

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
