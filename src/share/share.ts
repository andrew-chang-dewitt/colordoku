/**
 * Builds the link that reproduces this exact board: `?size=` picks the grid
 * size, `?board-id=` pins the seed so generation resolves single-worker and
 * deterministic (see src/board/generate.ts's doc comments on generateCells)
 * instead of racing several candidates and keeping whichever wins. Pure and
 * independent of `window.location` — the caller passes origin/pathname in —
 * so it's testable without a browser.
 */
export function buildShareUrl(
  size: number,
  boardId: number,
  origin: string,
  pathname: string,
): string {
  const params = new URLSearchParams({
    size: String(size),
    "board-id": String(boardId),
  });
  return `${origin}${pathname}?${params.toString()}`;
}

export interface ShareButtonConfig {
  /** Called fresh on every click, not cached — the URL only ever depends on values fixed at board-creation, but this keeps the button honest if that ever stops being true. */
  getUrl: () => string;
  title?: string;
  text?: string;
}

export interface ShareButton {
  html: HTMLButtonElement;
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
  const DEFAULT_LABEL = "Share";

  const html = document.createElement("button");
  html.type = "button";
  html.className = `btn btn-secondary`;
  html.textContent = DEFAULT_LABEL;

  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Swaps the button's label to `message` for `ms`, then restores it — the confirmation itself. */
  function flash(message: string, ms: number): void {
    if (resetTimer !== null) clearTimeout(resetTimer);
    html.textContent = message;
    html.disabled = true;
    resetTimer = setTimeout(() => {
      html.textContent = DEFAULT_LABEL;
      html.disabled = false;
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

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
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

  html.addEventListener("click", () => {
    void share();
  });

  return { html };
}
