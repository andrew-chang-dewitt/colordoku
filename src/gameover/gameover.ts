import classes from "./gameover.module.css";
import { formatElapsed } from "../timer/timer";

export interface GameOverResult {
  state: 1 | 2; // won, lost
  elapsedMs: number;
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
}: GameOverConfig): GameOver {
  const html = document.createElement("dialog");
  html.className = classes.modal;

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  html.append(heading);

  const message = document.createElement("p");
  message.className = classes.message;
  html.append(message);

  const actions = document.createElement("div");
  actions.className = classes.actions;

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

  html.append(actions);

  html.addEventListener("cancel", (event) => event.preventDefault());

  return {
    html,

    show({ state, elapsedMs }) {
      const won = state === 1;
      html.classList.toggle(classes.won, won);
      html.classList.toggle(classes.lost, !won);
      heading.textContent = won ? "You won!" : "Out of guesses";
      message.textContent = won
        ? `Solved in ${formatElapsed(elapsedMs)}.`
        : "No guesses left — better luck next time.";
      if (!html.open) html.showModal();
    },
  };
}
