import classes from "./game.module.css";

export interface Game {
  readonly size: number;
  guessesLeft: number;
  queensFound: number;
  state: 0 | 1 | 2; // continuing, won, lost

  incFound: () => void;
  incGuess: () => void;

  html: HTMLUListElement;
  update: () => void;
}

export function newGame(size: number, max: number): Game {
  const html = renderGame(max);

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
      }
    },

    incGuess() {
      this.guessesLeft--;
      this.update();
      if (this.guessesLeft == 0) {
        this.state = 2;
      }
    },

    update() {
      for (let i = this.guessesLeft; i < max; i++) {
        this.html.children[i].className = classes.used;
      }
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
