import "./style.css";
import { newBoard } from "./board/board";
import { SLOW_SIZE, preload } from "./board/generate";
import { newOptions, goToSize } from "./options/options";
import { newTimer } from "./timer/timer";
import { newGameOver } from "./gameover/gameover";

const app = document.querySelector("#app")!;

// ?size= picks the board size; ?seed= reproduces a specific board. Arriving with
// no size means the player has not chosen one yet, so the options drawer opens
// instead of a board being generated.
const params = new URLSearchParams(location.search);
const sizeParam = params.get("size");
const seedParam = params.get("seed");
const seed = seedParam === null ? undefined : Number(seedParam);

const options = newOptions({
  size: sizeParam === null ? undefined : Number(sizeParam),
});
app.append(options.html);

interface Status {
  html: HTMLDivElement;
  dispose: () => void;
}

/**
 * Generation runs in a worker, so the page can report progress and stay
 * clickable while it works. Above SLOW_SIZE that matters — the largest boards
 * take tens of seconds — so those also get an elapsed timer and a cancel button.
 */
function newStatus(size: number, controller: AbortController): Status {
  const html = document.createElement("div");
  html.id = "status";

  const label = document.createElement("p");
  label.textContent = `Generating a ${size}x${size} board…`;
  html.append(label);

  if (size < SLOW_SIZE) {
    return { html, dispose: () => html.remove() };
  }

  const note = document.createElement("p");
  note.textContent = "Boards this large can take a while.";
  html.append(note);

  const elapsed = document.createElement("p");
  const started = Date.now();
  const tick = setInterval(() => {
    elapsed.textContent = `${Math.round((Date.now() - started) / 1000)}s elapsed`;
  }, 250);
  html.append(elapsed);

  const cancel = document.createElement("button");
  cancel.className = "btn btn-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => controller.abort());
  html.append(cancel);

  return {
    html,
    dispose: () => {
      clearInterval(tick);
      html.remove();
    },
  };
}

function newGameButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "new-game";
  button.className = "btn btn-primary";
  button.textContent = "New game";
  button.addEventListener("click", () => options.open({ dismissable: true }));
  return button;
}

async function main(): Promise<void> {
  if (sizeParam === null) {
    // Nothing behind the drawer to go back to, so it cannot be dismissed.
    options.open({ dismissable: false });
    return;
  }

  const size = Number(sizeParam);
  const controller = new AbortController();
  const status = newStatus(size, controller);
  app.append(status.html);
  preload();

  try {
    const board = await newBoard(size, seed, controller.signal);
    app.append(board.html);

    // Timer starts once the board is actually playable (after generation,
    // not during it — the in-progress status above has its own elapsed
    // clock for that separate concern) and stops the moment the game ends.
    const timer = newTimer();
    board.game.html.insertAdjacentElement("afterend", timer.html);
    timer.start();

    const gameOver = newGameOver({
      onNewGame: () => goToSize(size),
      onChangeOptions: () => options.open({ dismissable: true }),
    });
    app.append(gameOver.html);

    board.game.onEnd((state) => {
      timer.stop();
      gameOver.show({ state, elapsedMs: timer.elapsedMs() });
    });

    if (import.meta.env.DEV) {
      // Dev-only convenience for manual/e2e testing: exposes the real queen
      // layout so a win/loss can be forced without solving the puzzle.
      // import.meta.env.DEV is stripped by Vite in production builds.
      (window as unknown as { __board?: typeof board }).__board = board;
    }
  } catch (err) {
    const message = document.createElement("p");
    message.textContent = `Could not generate a ${size}x${size} board: ${
      err instanceof Error ? err.message : String(err)
    }`;
    app.append(message);
  } finally {
    status.dispose();
    // Offered either way: after a failure it is the way to pick another size.
    app.append(newGameButton());
  }
}

void main();
