/**
 * The "Start over" button: resets progress on the current board without
 * regenerating a different one. Deliberately distinct from "New game" (the
 * options drawer, or gameover's "New game, same size") — those discard the
 * board entirely and pick a fresh layout; this keeps the exact same one and
 * only resets the player's progress on it. See options.ts's startOver() for
 * the actual abandon-then-navigate side effect this button triggers; this
 * module is only the confirm-gated UI in front of it, kept separately
 * testable from that side effect (same split share.ts uses between its
 * button and buildShareUrl).
 */

export interface StartOverButtonConfig {
  /** Called only after the player confirms — see `confirm` below. */
  onConfirm: () => void;
  /**
   * Injectable so tests don't need a real confirm() dialog. Defaults to the
   * browser's native window.confirm — a real confirmation step matters here:
   * unlike starting fresh from an empty options drawer (nothing to lose
   * yet), this discards actual in-progress marks/guesses/elapsed time, and —
   * reusing the same seed — can still trigger a real, possibly
   * tens-of-seconds regeneration on a large board (an explicit seed still
   * runs the full generator, just deterministically; see
   * src/board/generate.ts). A plain click is too easy to fire by accident
   * for something with that cost. No existing dialog component in this app
   * fits a lightweight yes/no (the drawer and gameover modal are both much
   * heavier, purpose-built flows), and window.confirm needs no new UI to
   * build, style, or test — the simplest thing that actually interrupts an
   * accidental click.
   */
  confirm?: (message: string) => boolean;
}

const CONFIRM_MESSAGE = "Start over on this board? Your current progress will be lost.";

export function newStartOverButton({
  onConfirm,
  confirm = (message) => window.confirm(message),
}: StartOverButtonConfig): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-secondary";
  button.textContent = "Start over";

  button.addEventListener("click", () => {
    if (confirm(CONFIRM_MESSAGE)) onConfirm();
  });

  return button;
}
