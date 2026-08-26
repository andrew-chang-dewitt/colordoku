import "./style.css";
import { newBoard } from "./board/board";
import { SLOW_SIZE, preload } from "./board/generate";

const app = document.querySelector("#app")!;

// ?size= and ?seed= are the cheapest way to exercise arbitrary board sizes until
// there is a real new-game UI. The same seed always reproduces the same board.
const params = new URLSearchParams(location.search);
const size = Number(params.get("size") ?? 8);
const seedParam = params.get("seed");
const seed = seedParam === null ? undefined : Number(seedParam);

interface Status {
  html: HTMLDivElement;
  dispose: () => void;
}

/**
 * Generation runs in a worker, so the page can report progress and stay
 * clickable while it works. Above SLOW_SIZE that matters — the largest boards
 * take tens of seconds — so those also get an elapsed timer and a cancel button.
 */
function newStatus(controller: AbortController): Status {
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

async function main(): Promise<void> {
  const controller = new AbortController();
  const status = newStatus(controller);
  app.append(status.html);
  preload();

  try {
    const board = await newBoard(size, seed, controller.signal);
    app.append(board.html);
  } catch (err) {
    const message = document.createElement("p");
    message.textContent = `Could not generate a ${size}x${size} board: ${
      err instanceof Error ? err.message : String(err)
    }`;
    app.append(message);
  } finally {
    status.dispose();
  }
}

void main();
