import classes from "./usermenu.module.css";

/**
 * The profile menu: a small dropdown off the hamburger button in the
 * top-right of the board's chrome row, per README.md's `#user-data` TODO.
 * Three items — game history, user preferences, leaderboard — of which only
 * "game history" does anything yet; the other two render as real,
 * fully-shaped menu items (so the menu isn't missing pieces visually) but
 * are hard-disabled rather than wired to fake behavior, since nothing exists
 * yet for them to open.
 *
 * Deliberately NOT another `<dialog>` (the house pattern options.ts,
 * gameover.ts, and historyview.ts all use): those are full takeovers —
 * `showModal()`'s backdrop, focus trap, and page-blocking weight — right for
 * a drawer or a forced choice, wrong for a lightweight anchored dropdown that
 * should feel like flipping a light switch next to the button that opened it.
 * The browser's native Popover API (`popover` attribute) would be the
 * obvious lighter-weight choice for exactly this shape, but it has no
 * support in this project's test environment (happy-dom implements neither
 * `showPopover()`/`hidePopover()` nor `:popover-open`), which would leave the
 * open/close/dismiss behavior entirely untested by `npm test` — so this
 * builds the same "small anchored panel" shape by hand instead: a plain
 * `hidden`-toggled `<div>`, positioned via CSS relative to a wrapper. That
 * also matches how options.ts already handles its own dismiss logic (a
 * manual click-target check, not delegating to a newer platform API), so
 * it's consistent with this app's existing house style, not a second one.
 *
 * Closing behavior: clicking outside the menu, pressing Escape, or clicking
 * "Game history" (the only real action) all close it. Clicking a disabled
 * item does nothing at all — disabled buttons don't fire click events, so
 * there's nothing to wire up for "don't fake it not doing anything."
 *
 * Accessibility: the trigger is a real, natively focusable `<button>` with
 * `aria-label="Menu"` (the hamburger icon alone isn't self-describing),
 * `aria-haspopup="true"`, and `aria-expanded` kept in sync with open/closed
 * state. The menu itself is a labelled (`aria-label="Profile menu"`)
 * container of real `<button>` items — not `role="menu"`/`role="menuitem"`:
 * that ARIA pattern requires full roving-tabindex arrow-key navigation to
 * behave correctly, and assigning the role without implementing that is a
 * known anti-pattern that actively misleads screen reader users (it
 * announces keyboard behavior that then doesn't work). Plain buttons are
 * already correctly focusable and activatable via Tab/Enter/Space without
 * that extra machinery; arrow-key roving is a nice-to-have left for later,
 * not required for this to be a real accessible menu. On open, focus moves
 * to the first item; on close via Escape while focus was inside the menu,
 * focus returns to the trigger button, so keyboard users don't lose their
 * place either way.
 */

export interface UserMenuConfig {
  /**
   * Opens the game history view (src/historyview/historyview.ts's
   * `HistoryView.open()`) — this menu's only real action right now. The
   * integration point the rest of this menu is built around: whatever
   * caller wires this module in only needs to pass that one function
   * through, nothing about usermenu.ts itself needs to know historyview.ts
   * exists.
   */
  onOpenHistory: () => void;
  /**
   * Opens the score over time view (src/scoreview/scoreview.ts's
   * `ScoreView.open()`) — displays cumulative score tracking by week.
   */
  onOpenScoreView: () => void;
}

export interface UserMenu {
  /** Wrapper containing both the trigger button and the dropdown panel — append this one element wherever the menu button belongs. */
  html: HTMLDivElement;
  /**
   * Removes the document-level click/keydown listeners this menu attaches
   * for click-outside/Escape dismissal. A real page only ever builds one of
   * these (torn down by a full navigation), so production code has no
   * particular need to call this — it exists for tests, which build many
   * short-lived menus in the same long-lived jsdom/happy-dom `document` and
   * would otherwise leak a listener (closing over that test's now-discarded
   * menu) into every test that runs afterward. Same pattern/reasoning as
   * board.ts's attachRangeGestures dispose return.
   */
  dispose: () => void;
}

export function newUserMenu({ onOpenHistory, onOpenScoreView }: UserMenuConfig): UserMenu {
  let open = false;

  const wrapper = document.createElement("div");
  wrapper.className = classes.wrapper;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "user-menu";
  button.className = "btn btn-secondary";
  button.setAttribute("aria-label", "Menu");
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");

  // Classic hamburger glyph (three horizontal lines) — same inline-SVG,
  // no-icon-font/library approach share.ts's button just landed:
  // `stroke="currentColor"` so it inherits .btn-secondary's text color
  // automatically in both themes, decorative (aria-hidden) since the
  // button's own aria-label already names it.
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "inline-flex";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>' +
    "</svg>";
  button.append(icon);
  wrapper.append(button);

  const menu = document.createElement("div");
  menu.className = classes.menu;
  menu.setAttribute("aria-label", "Profile menu");
  menu.hidden = true;
  wrapper.append(menu);

  function menuItem(label: string, options: { disabled?: boolean } = {}): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = classes.item;
    item.textContent = label;
    if (options.disabled) {
      item.disabled = true;
      item.title = "Coming soon";
    }
    menu.append(item);
    return item;
  }

  const historyItem = menuItem("Game history");
  historyItem.addEventListener("click", () => {
    setOpen(false);
    onOpenHistory();
  });

  const scoreItem = menuItem("Score over time");
  scoreItem.addEventListener("click", () => {
    setOpen(false);
    onOpenScoreView();
  });

  // Neither has anything built yet to link to — real, fully-shaped menu
  // items (so the menu isn't visually missing pieces) rather than wired to
  // placeholder behavior. "Leaderboard (if opted in)" per the README TODO:
  // there's no opt-in mechanism yet either, so it's unconditionally disabled
  // for now rather than guessing at what "opted in" should check.
  menuItem("User preferences", { disabled: true });
  menuItem("Leaderboard", { disabled: true });

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));

    if (open) {
      historyItem.focus();
    } else if (wrapper.contains(document.activeElement)) {
      // Focus was inside the menu (e.g. closed via Escape) — return it to
      // the trigger rather than letting it fall back to <body>.
      button.focus();
    }
  }

  button.addEventListener("click", () => setOpen(!open));

  function onDocumentClick(event: MouseEvent): void {
    if (!open) return;
    if (event.target instanceof Node && wrapper.contains(event.target)) return;
    setOpen(false);
  }

  function onDocumentKeydown(event: KeyboardEvent): void {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
  }

  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);

  return {
    html: wrapper,
    dispose() {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onDocumentKeydown);
    },
  };
}
