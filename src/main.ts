import "./style.css";
import type { Board } from "./board/board";
import { newBoard, attachKeyboardNavigation, maxGuessesFor } from "./board/board";
import { SLOW_SIZE, preload } from "./board/generate";
import type { Difficulty } from "./options/options";
import { newOptions, goToSize, startOver, isDifficulty, DEFAULT_DIFFICULTY } from "./options/options";
import { newTimer } from "./timer/timer";
import { newGameOver } from "./gameover/gameover";
import type { SavedGame } from "./persistence/persistence";
import { loadGame, saveGame } from "./persistence/persistence";
import {
  recordAttempt,
  statusFromGameState,
  getHistory,
  currentAttemptNumber,
  latestAttemptFor,
} from "./persistence/history";
import { computeScore } from "./persistence/score";
import { weeklyScoreTotal, currentWeekBounds } from "./persistence/weeklyScore";
import { buildShareUrl, newShareButton } from "./share/share";
import { newStartOverButton } from "./startover/startover";
import { newHistoryView } from "./historyview/historyview";
import { newScoreView } from "./scoreview/scoreview";
import { newUserMenu } from "./usermenu/usermenu";
import { newHelpOverlay } from "./help/help";

const app = document.querySelector("#app")!;

// ?size= picks the board size; ?board-id= reproduces a specific board (an
// opaque identifier — really the seed that produced it, but not exposed as
// "seed" in the URL: once generation can race several candidate seeds and
// keep whichever wins, the value here isn't something a player meaningfully
// chose in advance, just an identifier for one specific generated board).
// Arriving with no size means the player has not chosen one yet, so the
// options drawer opens instead of a board being generated.
const params = new URLSearchParams(location.search);
const sizeParam = params.get("size");
const boardIdParam = params.get("board-id");
const seed = boardIdParam === null ? undefined : Number(boardIdParam);
// Same fallback shape as size/seed above: an invalid or missing
// `?difficulty=` resolves to the app's own default rather than failing —
// this is only the *URL's* difficulty though; a resumable SavedGame's own
// stored difficulty still wins inside main() below, same as seed does.
const difficultyParam = params.get("difficulty");
const urlDifficulty: Difficulty = isDifficulty(difficultyParam) ? difficultyParam : DEFAULT_DIFFICULTY;

const options = newOptions({
  size: sizeParam === null ? undefined : Number(sizeParam),
  difficulty: urlDifficulty,
});
app.append(options.html);

const helpOverlay = newHelpOverlay();
app.append(helpOverlay.html);

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

  // Purely decorative — the label text already says what's happening — so it
  // stays out of the accessibility tree rather than announcing as an image.
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  html.append(spinner);

  const label = document.createElement("p");
  label.className = "status-label";
  label.textContent = `Generating a ${size}x${size} board…`;
  html.append(label);

  if (size < SLOW_SIZE) {
    return { html, dispose: () => html.remove() };
  }

  const note = document.createElement("p");
  note.className = "status-note";
  note.textContent = "Boards this large can take a while.";
  html.append(note);

  const meta = document.createElement("div");
  meta.className = "status-meta";

  const elapsed = document.createElement("p");
  const started = Date.now();
  const tick = setInterval(() => {
    elapsed.textContent = `${Math.round((Date.now() - started) / 1000)}s elapsed`;
  }, 250);
  meta.append(elapsed);

  const cancel = document.createElement("button");
  cancel.className = "btn btn-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => controller.abort());
  meta.append(cancel);

  html.append(meta);

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
  button.className = "btn btn-primary";
  button.textContent = "New game";
  button.addEventListener("click", () => options.open({ dismissable: true }));
  return button;
}

/**
 * A saved game only counts as resumable for the board we're about to show:
 * same size, and — if the URL names an explicit board — the same board. A
 * mismatched explicit `?board-id=` means the player deliberately navigated to
 * a specific (probably different) board, which should win over whatever was
 * left mid-play; that new board simply overwrites the save the next time the
 * player interacts with it.
 */
function resumableSave(size: number): SavedGame | null {
  const saved = loadGame();
  if (saved === null || saved.size !== size) return null;
  if (boardIdParam !== null && Number(boardIdParam) !== saved.seed) return null;
  return saved;
}

/** Snapshots everything persistence.ts's SavedGame needs from the live board + timer. */
function snapshot(
  board: Board,
  timer: ReturnType<typeof newTimer>,
  difficulty: Difficulty,
): Omit<SavedGame, "version"> {
  return {
    size: board.game.size,
    seed: board.seed,
    guessesLeft: board.game.guessesLeft,
    queensFound: board.game.queensFound,
    gameState: board.game.state,
    elapsedMs: timer.elapsedMs(),
    difficulty,
    cells: board.state.map((row) =>
      row.map((cell) => ({ state: cell.state, frozen: cell.frozen })),
    ),
  };
}

async function main(): Promise<void> {
  if (sizeParam === null) {
    // Nothing behind the drawer to go back to, so it cannot be dismissed.
    options.open({ dismissable: false });
    return;
  }

  const mainHtml = document.createElement("div");
  mainHtml.id = "main";
  app.append(mainHtml);

  // build persistant top row header to access user data menu at any time
  const aboveBoardRow = document.createElement("div");
  aboveBoardRow.id = "above-board";
  const aboveBoardRowLeft = document.createElement("div");
  aboveBoardRowLeft.id = "above-board-left";
  aboveBoardRow.append(aboveBoardRowLeft);
  const aboveBoardRowCenter = document.createElement("div");
  aboveBoardRowCenter.id = "above-board-center";
  aboveBoardRow.append(aboveBoardRowCenter);
  const aboveBoardRowRight = document.createElement("div");
  aboveBoardRowRight.id = "above-board-right";
  aboveBoardRow.append(aboveBoardRowRight);
  mainHtml.append(aboveBoardRow);

  // Independent of any particular board (it reads persistence/history.ts's
  // whole stored history, not this session's), so it's built and wired here,
  // before the try block, rather than gated on a successful board load like
  // the share/start-over buttons are.
  const historyView = newHistoryView({ onPlayAgain: startOver });
  app.append(historyView.html);

  const scoreView = newScoreView({
    onViewInHistory: (entryId) => {
      scoreView.close();
      historyView.open(entryId);
    },
  });
  app.append(scoreView.html);

  const userMenu = newUserMenu({
    onOpenHistory: () => historyView.open(),
    onOpenScoreView: () => scoreView.open(),
  });
  aboveBoardRowRight.append(userMenu.html);

  // placeholder for board while generating (spinner & cancel button)
  const size = Number(sizeParam);
  const saved = resumableSave(size);
  const controller = new AbortController();
  const status = newStatus(size, controller);
  mainHtml.append(status.html);
  preload();

  // Placed as #new-game's DOM sibling once both exist — see the finally
  // block below — so the two read as a related pair: "start fresh at a new
  // size" next to "restart this exact board". Declared out here (rather than
  // inside the try block, where it's actually created) so finally can still
  // see it; stays undefined on a generation failure, when there's no board
  // to restart and so nothing to pair #new-game with.
  let startOverButton: HTMLButtonElement | undefined;

  try {
    // A resumable save pins the seed so generation reproduces the exact same
    // region/queen layout; player progress (marks, guesses, elapsed time) is
    // then re-applied on top of that freshly generated board below.
    // Same precedence as size/seed below: a resumed game's own recorded
    // difficulty wins over whatever the current URL says (a share link or
    // bookmark might carry no `?difficulty=`, or a different one, from a
    // later visit) — this is the one authoritative difficulty value for the
    // rest of this session, used for board generation, persistence, and
    // scoring.
    const difficulty: Difficulty = saved?.difficulty ?? urlDifficulty;
    const board = await newBoard(size, difficulty, saved?.seed ?? seed, controller.signal);
    aboveBoardRowCenter.append(board.htmlHud);

    mainHtml.append(board.htmlBoard);

    if (saved !== null) {
      board.state.forEach((row, r) =>
        row.forEach((cell, c) =>
          cell.restore(saved.cells[r][c].state, saved.cells[r][c].frozen),
        ),
      );
      board.game.guessesLeft = saved.guessesLeft;
      board.game.queensFound = saved.queensFound;
      board.game.state = saved.gameState;
      board.game.update();
    }

    // Timer starts once the board is actually playable (after generation,
    // not during it — the in-progress status above has its own elapsed
    // clock for that separate concern) and stops the moment the game ends.
    // A resumed game restores the saved elapsed time instead of starting
    // from zero — still running if play was in progress, frozen if it had
    // already ended.
    const timer = newTimer();
    board.htmlHud.insertAdjacentElement("beforeend", timer.html);
    if (saved !== null) {
      timer.restore(saved.elapsedMs, saved.gameState === 0);
    } else {
      timer.start();
    }

    // Only offered once the board actually exists (i.e. from here on, not
    // during the loading/status view above, and not at all if generation
    // fails below) — before that there's no resolved board-id to put in a
    // link, so a link that only sometimes works isn't worth showing.
    const share = newShareButton({
      getUrl: () =>
        buildShareUrl(size, board.seed, location.origin, location.pathname, difficulty),
    });
    aboveBoardRowLeft.append(share.html);

    // "Start over": resets progress on this exact board (same seed) rather
    // than picking a different one, distinct from both "New game" entry
    // points (options drawer, gameover's "New game, same size") — see
    // options.ts's startOver() for the abandon-then-navigate side effect,
    // which reuses this same page's whole generate-and-mount path via a full
    // navigation back to this board's own `?size=`+`?board-id=`. Only
    // offered while a game is genuinely in progress — hidden below once the
    // game ends (live, via onEnd) or if it had already ended before this
    // page even loaded (the resumed-save branch further down); nothing is
    // "in progress" left to abandon at that point, and gameover's own modal
    // takes over the board anyway. Not inserted into the DOM here — see the
    // finally block below, where it's placed next to #new-game.
    //
    // Assigned to the outer `startOverButton` right below so finally can
    // place it, but this local const is what the closures further down
    // (onEnd, the resumed-save branch) actually close over — TS can't carry
    // definite-assignment narrowing into a closure for a mutable outer
    // binding, so those reference this const instead of the outer variable.
    const startOverBtn = newStartOverButton({
      onConfirm: () => startOver(size, board.seed, difficulty),
    });
    startOverButton = startOverBtn;

    const gameOver = newGameOver({
      onNewGame: () => goToSize(size, difficulty),
      onChangeOptions: () => options.open({ dismissable: true }),
      onTryAgain: () => startOver(size, board.seed, difficulty),
      getShareUrl: () =>
        buildShareUrl(size, board.seed, location.origin, location.pathname, difficulty),
    });
    app.append(gameOver.html);

    // Build the "is any dialog open" predicate used by keyboard navigation
    const isAnyDialogOpen = () =>
      options.html.open || gameOver.html.open || helpOverlay.html.open;

    // Wire up keyboard navigation (called here, not inside newBoard, so we have
    // access to the dialog state that was constructed in main.ts)
    attachKeyboardNavigation(board.htmlBoard, board.state, board.game, isAnyDialogOpen, {
      onHelp: () => helpOverlay.open(),
    });

    const maxGuesses = maxGuessesFor(size, difficulty);
    const wrongGuessesFrom = (guessesLeft: number): number => maxGuesses - guessesLeft;

    // Checkpoints both SavedGame (single-slot "resume where I left off") and
    // this attempt's history entry (see persistence/history.ts) on the same
    // cadence — every cell interaction plus the two "player might be about
    // to leave" signals below, and once more at game end via onEnd. History
    // status is derived from the live game state, so a still-playing
    // checkpoint always writes "playing" and the very last persist() after
    // onEnd (game.state already flipped to 1/2 by then) writes the real
    // won/lost outcome — no separate "finalize" call needed here.
    //
    // Score is only ever computed once status is actually final — see
    // persistence/score.ts's computeScore, whose FinishedStatus type
    // excludes "playing" on purpose. Every "playing" checkpoint here still
    // writes `score: null` explicitly (rather than omitting it) so a stray
    // late checkpoint can never accidentally leave a *stale* score sitting
    // on an entry that's since gone back to "playing" — not a real scenario
    // today (status only ever moves forward: playing -> won/lost/abandoned,
    // never back), but cheap to make impossible outright rather than rely
    // on that invariant holding forever.
    const persist = (): void => {
      saveGame(snapshot(board, timer, difficulty));
      const status = statusFromGameState(board.game.state);
      recordAttempt(board.game.size, board.seed, {
        status,
        elapsedMs: timer.elapsedMs(),
        difficulty,
        score:
          status === "playing"
            ? null
            : computeScore(
                board.game.size,
                difficulty,
                timer.elapsedMs(),
                status,
                currentAttemptNumber(board.game.size, board.seed),
                wrongGuessesFrom(board.game.guessesLeft),
              ),
      });
    };

    board.game.onEnd((state) => {
      timer.stop();
      const elapsedMs = timer.elapsedMs();
      const statusForScore = state === 1 ? "won" : "lost";
      const score = computeScore(
        size,
        difficulty,
        elapsedMs,
        statusForScore,
        currentAttemptNumber(size, board.seed),
        wrongGuessesFrom(board.game.guessesLeft),
      );
      // Game over; the timer will never run again on this page, so drop its
      // visibilitychange listener rather than leaving it dangling until a
      // full page navigation cleans it up.
      timer.dispose();
      // Nothing "in progress" left to abandon once the game has actually
      // ended — see startOverButton's own comment above.
      startOverBtn.hidden = true;
      // Persist the final state so a reload re-shows the same game-over
      // modal instead of silently starting a new board — the save is only
      // cleared by an explicit "new game" action (see options.ts's goToSize).
      // Must run BEFORE computing weeklyScore below: persist() is what
      // writes this game's own score into history via recordAttempt(), so
      // weeklyScoreTotal(getHistory(), ...) only includes this game's score
      // if history has already been written by the time it runs.
      persist();
      const weeklyScore = weeklyScoreTotal(getHistory(), currentWeekBounds());
      gameOver.show({ state, elapsedMs, score, size, weeklyScore });
    });

    if (saved !== null && saved.gameState !== 0) {
      // The saved game was already won/lost — nothing to play, so go
      // straight to the game-over modal rather than a live, interactive
      // (but pointless) restored board sitting behind it. Same reasoning as
      // onEnd above: nothing in progress to offer "Start over" on.
      startOverBtn.hidden = true;
      const statusForScore = saved.gameState === 1 ? "won" : "lost";
      const priorAttempt = latestAttemptFor(size, saved.seed)?.attempt ?? 1;
      const score = computeScore(
        size,
        difficulty,
        saved.elapsedMs,
        statusForScore,
        priorAttempt,
        wrongGuessesFrom(saved.guessesLeft),
      );
      // No fresh persist() needed here — this game already ended and was
      // recorded in a prior session, so its score is already in history.
      const weeklyScore = weeklyScoreTotal(getHistory(), currentWeekBounds());
      gameOver.show({ state: saved.gameState, elapsedMs: saved.elapsedMs, score, size, weeklyScore });
    } else {
      // Persist on every interaction with a cell (marking, eliminating, or
      // guessing) — cheap, bounded by how often the player actually clicks,
      // and simplest way to keep the save exactly in sync with the board.
      // Bubbles up from whichever cell button was the real event target, so
      // it always fires after that cell's own click handler already mutated
      // its state. cell.ts detects both a mark-toggle and a guess-commit
      // from the same native "click" event (its own debounced double-click
      // logic, not a native dblclick), so listening for "click" alone here
      // covers every interaction. Also persist on the two "player might be
      // about to leave" signals, so idle elapsed time between clicks isn't
      // lost: visibilitychange (mobile browsers may never fire beforeunload)
      // and beforeunload itself (covers desktop reload/close reliably) — see
      // persistence.ts's abandonGame() for how starting a new game avoids
      // this beforeunload handler racing that intentional abandonment.
      board.htmlBoard.addEventListener("click", persist);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) persist();
      });
      window.addEventListener("beforeunload", persist);

      if (saved === null) {
        // First save for a brand-new board, so a reload before any
        // interaction still resumes into this exact board rather than
        // generating a different random one.
        persist();
      }
    }

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
    // put both buttons in a row
    const belowBoardRow = document.createElement("div");
    belowBoardRow.id = "below-board";
    app.append(belowBoardRow);
    // Offered either way: after a failure it is the way to pick another size.
    const newGame = newGameButton();
    belowBoardRow.append(newGame);
    // Paired as #new-game's immediate DOM sibling — see startOverButton's
    // own comment above for why it's only ever defined on a successful
    // generation, and hidden (not omitted) once nothing is in progress.
    if (startOverButton !== undefined) {
      belowBoardRow.append(startOverButton);
    }
  }
}

void main();
