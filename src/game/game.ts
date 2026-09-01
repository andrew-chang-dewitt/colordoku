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

  html: HTMLElement;
  update: () => void;
}

export function newGame(size: number, max: number): Game {
  const { wrapper, pips, counter } = renderGame(size, max);
  const listeners: Array<(state: 1 | 2) => void> = [];

  function notifyEnd(state: 1 | 2): void {
    for (const cb of listeners) cb(state);
  }

  return {
    size,
    html: wrapper,
    guessesLeft: max,
    queensFound: 0,
    state: 0,

    incFound() {
      this.queensFound++;
      this.update();
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
        pips.children[i].className = classes.used;
      }
      counter.textContent = `${this.queensFound} of ${this.size} queens found`;
    },

    onEnd(cb) {
      listeners.push(cb);
    },
  };
}

function renderGame(
  size: number,
  max: number
): { wrapper: HTMLElement; pips: HTMLUListElement; counter: HTMLParagraphElement } {
  const wrapper = document.createElement("div");

  const counter = document.createElement("p");
  counter.className = classes.queensFound;
  counter.textContent = `0 of ${size} queens found`;

  const pips = document.createElement("ul");
  pips.className = classes.guesses;

  for (let i = 0; i < max; i++) {
    const guess = document.createElement("li");
    guess.className = classes.unused;
    pips.append(guess);
  }

  wrapper.append(counter, pips);

  return { wrapper, pips, counter };
}
