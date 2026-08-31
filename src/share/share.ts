import type { Difficulty } from "../options/options";

/**
 * Builds the link that reproduces this exact board: `?size=` picks the grid
 * size, `?board-id=` pins the seed so generation resolves single-worker and
 * deterministic (see src/board/generate.ts's doc comments on generateCells)
 * instead of racing several candidates and keeping whichever wins, and
 * `?difficulty=` pins the difficulty the board is played under (difficulty
 * affects both max guesses and score multiplier, so a shared board played at
 * a different difficulty is a different challenge). Pure and independent of
 * `window.location` — the caller passes origin/pathname in — so it's testable
 * without a browser.
 */
export function buildShareUrl(
  size: number,
  boardId: number,
  origin: string,
  pathname: string,
  difficulty: Difficulty,
): string {
  const params = new URLSearchParams({
    size: String(size),
    "board-id": String(boardId),
    difficulty,
  });
  return `${origin}${pathname}?${params.toString()}`;
}

export interface ShareButtonConfig {
  /** Called fresh on every click, not cached — the URL only ever depends on values fixed at board-creation, but this keeps the button honest if that ever stops being true. */
  getUrl: () => string;
  title?: string;
  text?: string | (() => string);
}

export interface ShareButton {
  html: HTMLElement;
}

/**
 * A single button that shares the current board's link: the Web Share API
 * (navigator.share) when the platform offers it — mobile browsers, mostly,
 * where it opens the native share sheet — otherwise a clipboard copy with a
 * brief on-button confirmation, which is the closest thing this app's plain,
 * dialog-free style has to a toast. Both paths can fail in ways that are not
 * really failures (the user simply closed the share sheet) or that have no
 * remaining automated option (Clipboard API missing in an insecure context,
 * or its permission denied) — see share()/copyToClipboard() for exactly how
 * each is handled without alarming the player over nothing.
 */
export function newShareButton({
  getUrl,
  title = "Colordoku",
  text = "Play this Colordoku board with me",
}: ShareButtonConfig): ShareButton {
  // Wrapper container for the button and flash message, positioned relatively
  // so the flash message can be absolutely positioned below the button.
  const container = document.createElement("div");
  container.style.position = "relative";
  container.style.display = "inline-block";

  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-secondary`;
  button.setAttribute("aria-label", title);

  // The classic iOS share glyph (an arrow pointing up out of an open-top
  // tray) — user-picked from three candidates (iOS box+arrow, Material
  // three-nodes, arrow-out-of-a-box). Plain inline SVG, no icon font/library:
  // this app has no dependency for one. `stroke="currentColor"` picks up
  // .btn-secondary's text color automatically in both themes, so it needs no
  // color of its own. Decorative only (aria-hidden) — the aria-label
  // attribute already says what the button does for accessibility.
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "inline-flex";
  icon.style.verticalAlign = "-0.15em";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 16V4"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>' +
    "</svg>";
  button.append(icon);
  container.append(button);

  // Button is now icon-only; a separate flash message element positioned
  // below the button shows confirmations ("Link copied!" or the raw URL
  // fallback) instead of swapping text inside the button itself.
  const flashMessage = document.createElement("div");
  flashMessage.style.display = "none";
  flashMessage.style.position = "absolute";
  flashMessage.style.top = "100%";
  flashMessage.style.left = "50%";
  flashMessage.style.transform = "translateX(-50%)";
  flashMessage.style.fontSize = "0.875rem";
  flashMessage.style.whiteSpace = "nowrap";
  flashMessage.style.marginTop = "0.5em";
  flashMessage.style.color = "var(--color-on-surface)";
  container.append(flashMessage);

  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Shows a message below the button for `ms`, then hides it — the confirmation itself. */
  function flash(message: string, ms: number): void {
    if (resetTimer !== null) clearTimeout(resetTimer);
    flashMessage.textContent = message;
    flashMessage.style.display = "block";
    button.disabled = true;
    resetTimer = setTimeout(() => {
      flashMessage.style.display = "none";
      button.disabled = false;
      resetTimer = null;
    }, ms);
  }

  async function copyToClipboard(url: string): Promise<void> {
    if (navigator.clipboard?.writeText === undefined) {
      // No Clipboard API at all — most commonly an insecure (non-HTTPS,
      // non-localhost) context, where browsers withhold it entirely — and
      // (since this is only reached when Web Share also isn't available)
      // nothing left to automate. Showing the link itself, long enough to
      // read and select, is the only fallback that still gets the player a
      // usable link rather than a dead button.
      flash(url, 5000);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied!", 1500);
    } catch {
      // Permission denied, or blocked for some other browser-specific
      // reason — same manual fallback as no Clipboard API at all.
      flash(url, 5000);
    }
  }

  async function share(): Promise<void> {
    const url = getUrl();
    const resolvedText = typeof text === "function" ? text() : text;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: resolvedText, url });
        return;
      } catch (err) {
        // The user closed the native share sheet without picking a target —
        // an ordinary cancel, not a failure, so there's nothing to show and
        // no fallback to run.
        if (err instanceof Error && err.name === "AbortError") return;
        // Any other failure (no share target installed, permission issue,
        // etc.) — fall through to the clipboard path rather than leaving
        // the player with nothing after a visibly failed share attempt.
      }
    }

    await copyToClipboard(url);
  }

  button.addEventListener("click", () => {
    void share();
  });

  return { html: container };
}
