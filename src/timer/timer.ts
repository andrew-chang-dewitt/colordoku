import classes from "./timer.module.css";

/** mm:ss, e.g. 0ms -> "0:00", 65_400ms -> "1:05". Pure so it's testable without a DOM. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface Timer {
  html: HTMLParagraphElement;
  /** Begins counting from now. A no-op if already running. */
  start: () => void;
  /** Stops updating the display and clears the interval. Safe to call more than once. */
  stop: () => void;
  /** Milliseconds since start() was called, minus any time spent paused; 0 if never started. */
  elapsedMs: () => number;
  /** Removes the visibilitychange listener. Call once the timer is no longer needed. */
  dispose: () => void;
  /**
   * Re-hydrates from a previously-saved elapsed value — for resuming a saved
   * game after reload. Pass `running: true` to keep counting up from there (a
   * resumed in-progress game); `false` to leave it stopped, showing a frozen
   * final time (a resumed already-finished game). Unlike start(), this always
   * takes effect, since it's meant to override whatever state the timer was
   * already in (fresh and never started).
   */
  restore: (elapsedMs: number, running: boolean) => void;
}

export function newTimer(): Timer {
  const html = document.createElement("p");
  html.className = classes.timer;
  html.textContent = formatElapsed(0);

  let startedAt: number | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  // True from start() until stop(). Distinct from `interval`, which also
  // gets cleared while auto-paused for tab visibility — `running` is the
  // "should this resume when the tab becomes visible again" intent, so a
  // stray visibilitychange after stop() (game already ended) is a no-op.
  let running = false;
  // Set to Date.now() when the interval is cleared because the tab went
  // hidden while running. On resume, the gap is added back into startedAt
  // so elapsedMs() excludes time spent hidden.
  let pausedAt: number | null = null;

  function render(): void {
    html.textContent = formatElapsed(
      startedAt === null ? 0 : (pausedAt ?? Date.now()) - startedAt,
    );
  }

  // Page Visibility API, not window blur/focus: blur/focus also fire when
  // focus moves to another app/window while this tab stays fully visible
  // on screen (e.g. a Spotlight search, a floating palette) — that should
  // NOT pause the timer. document.hidden only goes true when the tab is
  // actually not visible: another tab is active, the window is minimized,
  // another virtual desktop/space is active, or the screen is locked.
  function handleVisibilityChange(): void {
    if (!running) return;

    if (document.hidden) {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
        pausedAt = Date.now();
      }
    } else {
      if (pausedAt !== null && startedAt !== null) {
        startedAt += Date.now() - pausedAt;
        pausedAt = null;
      }
      if (interval === null) {
        render();
        interval = setInterval(render, 250);
      }
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    html,

    start() {
      if (running) return;
      running = true;
      pausedAt = null;
      startedAt = Date.now();
      render();
      interval = setInterval(render, 250);
    },

    stop() {
      running = false;
      pausedAt = null;
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    },

    elapsedMs() {
      if (startedAt === null) return 0;
      // While paused for hidden visibility, freeze at the moment it paused
      // rather than letting real time keep leaking in until resume shifts
      // startedAt forward.
      return (pausedAt ?? Date.now()) - startedAt;
    },

    dispose() {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },

    restore(elapsedMs, isRunning) {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      startedAt = Date.now() - elapsedMs;
      running = isRunning;
      if (isRunning) {
        pausedAt = null;
        render();
        interval = setInterval(render, 250);
      } else {
        // Freeze exactly like the hidden-tab pause does, via pausedAt — not
        // just skipping the interval — so elapsedMs() also stays pinned at
        // the restored value instead of drifting upward with real time.
        pausedAt = Date.now();
        render();
      }
    },
  };
}
