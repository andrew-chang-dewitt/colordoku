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
  /** Milliseconds since start() was called; 0 if never started. */
  elapsedMs: () => number;
}

export function newTimer(): Timer {
  const html = document.createElement("p");
  html.className = classes.timer;
  html.textContent = formatElapsed(0);

  let startedAt: number | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  function render(): void {
    html.textContent = formatElapsed(
      startedAt === null ? 0 : Date.now() - startedAt,
    );
  }

  return {
    html,

    start() {
      if (interval !== null) return;
      startedAt = Date.now();
      render();
      interval = setInterval(render, 250);
    },

    stop() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    },

    elapsedMs() {
      return startedAt === null ? 0 : Date.now() - startedAt;
    },
  };
}
