import classes from "./gameover.module.css";
import { formatElapsed } from "../timer/timer";
import { newShareButton } from "../share/share";

export interface GameOverResult {
  state: 1 | 2; // won, lost
  elapsedMs: number;
  score: number;
  size: number;
}

export interface GameOver {
  html: HTMLDialogElement;
  /** Opens the modal with win/loss-specific messaging. */
  show: (result: GameOverResult) => void;
}

export interface GameOverConfig {
  /** Start a fresh board at the same size. */
  onNewGame: () => void;
  /** Go to the options drawer to change size before starting. */
  onChangeOptions: () => void;
  /** Replay the same board (called by "Try again" button on loss). */
  onTryAgain: () => void;
  /** Called fresh on every click to get the share URL. */
  getShareUrl: () => string;
}

/**
 * The game-over interstitial. Unlike options.ts's drawer, this has no
 * dismissable state at all: Escape and backdrop clicks are always ignored, so
 * the player must pick one of the two actions rather than idle on a dead
 * board. <dialog> + showModal() is reused for the same reason it is in
 * options.ts — the board underneath becomes genuinely inert, not just
 * visually dimmed, which matters here because unguessed cells are still
 * clickable once the game has technically ended.
 */
export function newGameOver({
  onNewGame,
  onChangeOptions,
  onTryAgain,
  getShareUrl,
}: GameOverConfig): GameOver {
  const html = document.createElement("dialog");
  html.className = classes.modal;

  const confetti = document.createElement("div");
  confetti.className = classes.confetti;
  html.append(confetti);

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  html.append(heading);

  const message = document.createElement("p");
  message.className = classes.message;
  html.append(message);

  const score = document.createElement("p");
  score.className = classes.score;
  html.append(score);

  const actions = document.createElement("div");
  actions.className = classes.actions;

  const tryAgain = document.createElement("button");
  tryAgain.type = "button";
  tryAgain.className = "btn btn-secondary";
  tryAgain.textContent = "Try again";
  tryAgain.addEventListener("click", () => {
    html.close();
    onTryAgain();
  });
  actions.append(tryAgain);

  const changeOptions = document.createElement("button");
  changeOptions.type = "button";
  changeOptions.className = "btn btn-secondary";
  changeOptions.textContent = "Change size…";
  changeOptions.addEventListener("click", () => {
    html.close();
    onChangeOptions();
  });
  actions.append(changeOptions);

  const newGame = document.createElement("button");
  newGame.type = "button";
  newGame.className = "btn btn-primary";
  newGame.textContent = "New game, same size";
  newGame.addEventListener("click", () => {
    html.close();
    onNewGame();
  });
  actions.append(newGame);

  let shareSize = 4; // Default, will be set in show()
  let shareElapsedMs = 0; // Default, will be set in show()
  let shareScore = 0; // Default, will be set in show()

  const shareButton = newShareButton({
    getUrl: getShareUrl,
    text: () =>
      `I solved a ${shareSize}x${shareSize} Colordoku in ${formatElapsed(
        shareElapsedMs
      )} — score ${shareScore}!`,
  });
  actions.append(shareButton.html);

  html.append(actions);

  html.addEventListener("cancel", (event) => event.preventDefault());

  function createConfetti(): void {
    // Clear existing confetti
    confetti.innerHTML = "";

    const confettiCount = Math.random() * 16 + 24; // 24-40 pieces
    const colors = Array.from(
      { length: 16 },
      (_, i) => `var(--color-group-${i})`
    );

    for (let i = 0; i < confettiCount; i++) {
      const piece = document.createElement("span");
      piece.className = classes.confettiPiece;

      // Random horizontal start position (skewed toward edges)
      const xStart = Math.random() < 0.5
        ? Math.random() * 30 // 0-30% (left edge)
        : 70 + Math.random() * 30; // 70-100% (right edge)

      // Random launch angle around 45°
      const angleRad = ((30 + Math.random() * 30) * Math.PI) / 180;

      // Random fall duration and delay
      const duration = 2 + Math.random() * 1;
      const delay = Math.random() * 0.3;

      // Calculate horizontal offset based on angle and duration
      const xOffset = Math.cos(angleRad) * 80; // Scale of 80px

      // Random color from the palette
      const color = colors[Math.floor(Math.random() * colors.length)];

      piece.style.setProperty("--x-start", `${xStart}%`);
      piece.style.setProperty("--x-offset", `${xOffset}px`);
      piece.style.setProperty("--duration", `${duration}s`);
      piece.style.setProperty("--delay", `${delay}s`);
      piece.style.setProperty("--color", color);

      confetti.append(piece);

      // Remove piece after animation ends
      piece.addEventListener(
        "animationend",
        () => {
          piece.remove();
        },
        { once: true }
      );
    }
  }

  return {
    html,

    show({ state, elapsedMs, score: scoreValue, size }) {
      const won = state === 1;
      html.classList.toggle(classes.won, won);
      html.classList.toggle(classes.lost, !won);
      heading.textContent = won ? "You won!" : "Out of guesses";
      message.textContent = won
        ? `Solved in ${formatElapsed(elapsedMs)}.`
        : "No guesses left — better luck next time.";

      // Update share text variables for dynamic share message
      shareSize = size;
      shareElapsedMs = elapsedMs;
      shareScore = scoreValue;

      // Score line: shown only on win
      score.hidden = !won;
      if (won) {
        score.textContent = `Score: ${scoreValue}`;
      }

      // Confetti: plays only on win
      if (won) {
        createConfetti();
      } else {
        confetti.innerHTML = "";
      }

      // Share button: shown only on win
      shareButton.html.hidden = !won;

      // Try again button: shown only on loss
      tryAgain.hidden = won;

      if (!html.open) html.showModal();
    },
  };
}
