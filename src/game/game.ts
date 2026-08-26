import classes from "./game.module.css";

export interface Game {
  readonly size: number;
  guessesLeft: number;
  queensFound: number;
  state: 0 | 1 | 2; // continuing, won, lost

  incFound: () => void;
  incGuess: () => void;
  /**
   * Registers a callback fired exactly once, the moment `state` transitions
   * to won (1) or lost (2) — not on every call to incFound/incGuess, only the
   * one that actually flips the game over. Lets UI outside this module (a
   * win/loss modal) react without incFound/incGuess's call sites in cell.ts
   * needing to change.
   */
  onEnd: (cb: (state: 1 | 2) => void) => void;

  html: HTMLUListElement;
  update: () => void;
}

export function newGame(size: number, max: number): Game {
  const html = renderGame(max);
  const listeners: Array<(state: 1 | 2) => void> = [];

  function notifyEnd(state: 1 | 2): void {
    for (const cb of listeners) cb(state);
  }

  return {
    size,
    html,
    guessesLeft: max,
    queensFound: 0,
    state: 0,

    incFound() {
      this.queensFound++;
      if (this.queensFound == this.size) {
        this.state = 1;
        notifyEnd(1);
      }
    },

    incGuess() {
      this.guessesLeft--;
      this.update();
      if (this.guessesLeft == 0) {
        this.state = 2;
        notifyEnd(2);
      }
    },

    update() {
      for (let i = this.guessesLeft; i < max; i++) {
        this.html.children[i].className = classes.used;
      }
    },

    onEnd(cb) {
      listeners.push(cb);
    },
  };
}

function renderGame(max: number): HTMLUListElement {
  const html = document.createElement("ul");
  html.className = classes.guesses;

  for (let i = 0; i < max; i++) {
    const guess = document.createElement("li");
    guess.className = classes.unused;
    html.append(guess);
  }

  return html;
}
