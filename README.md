# colordoku

a sudoku-like game where the objective is to locate all the hidden queens,
implemented for the web.

## the game

to play the game, clone this repo, then run `npm run dev` in your terminal from
the repo root. if you navigate to the url prompted in your terminal (usually
`https://localhost:5173`) you'll see a game board generated.

building requires a rust toolchain with the `wasm32-unknown-unknown` target plus
[`wasm-pack`](https://rustwasm.github.io/wasm-pack/), since the board generator
compiles to wasm. `npm run dev`, `npm run build`, and `npm test` all build it for
you first.

pass `?size=` to pick a board size (1, or 4 through 16 — the stylesheet defines
16 region colours) and `?board-id=` to reproduce a specific board, e.g.
`http://localhost:5173/?size=8&board-id=42`.

### rules

given a square board containing a grid of `n` cells on each size partitioned
into `n` regions of varying sizes, your job is to find the `n` queens without
making too many incorrect guesses. use the following rules to guide you in
locating each queen without errors:

1. every column, row, & region contains exactly 1 queen.
2. no two queens can be adjacent (orthogonally _or_ diagonally).

### an example

suppose you have a simple board of 4 cells on each side (meaning 4 regions & 4
queens). it might be represented as 4 lines, with each space-separated letter
(`A`, `B`, `C`, or `D`) denoting a cell. additionally, you will see a row of
circles above the board (in this case, 2) indicating how many incorrect guesses
you have left before you lose.

```
  O O

B B B B
A B C C
C B C D
C C C D
```

because each region _must_ have exactly 1 queen, we know that the region `A`
has only one possible location for a queen. let's mark it with a `Q` for queen:

```
  O O

B B B B
Q B C C
C B C D
C C C D
```

next, because each row & column can contain only one queen, we know the top row
& left column can not contain a queen. additionally, the `B` cell in the 2nd
position of the 2nd column from the left & top can not contain a queen either
as it is diagonally adjacent to the queen we found in `A`. let's mark all of
those with an `x` to eliminate them.

```
  O O

x x B B
Q x x x
x x C D
x C C D
```

now with those eliminated we can use row/column portions of the same rule about
the `B` region & simlar about `D` to find 2 more queens; however, let's first
see what an incorrect guess looks like. let's try guessing that the `C` cell in
the 3rd from the left position in the bottom row is a queen.

```
  O X

x x B B
Q x x x
x x C D
x C x D
```

note how it will actually be marked with an `x` after our incorrect guess,
indicating we were wrong & eliminating the cell for us automatically.
additionally, see that the row of guesses in the top had one replaced with an
`X` &mdash; this shows us that we have only one incorrect guess left before we
lose.

now let us proceed to solve the puzzle. remember rule (1) above, where each
row/column must contain exactly 1 queen; this means that the right column can
only contain `D` cells since the `D` region exists only in that column. let's
eliminate all other cells in that column.

```
  O X

x x B x
Q x x x
x x C D
x C x D
```

now there's only one `B`, so we can mark it as a queen & eliminate all other
cells in the same column.

```
  O X

x x Q x
Q x x x
x x x D
x C x D
```

same thing with `C` will eliminate the bottom `D`, leaving only one possibility
for the last queen as well. let's mark them both to win the game.

```
  O X

x x Q x
Q x x x
x x x Q
x Q x x
```

## the implementation

DOM manipulation & game state logic are written in typescript with the view
implemented in html & css, all built with vite. board generation is a WASM
module written in rust (`generator/`), which builds a board with a guarantee of
exactly one possible solution far faster than the same algorithm in a scripting
language.

generation runs in a web worker, so the page stays responsive while it works. it
needs to: the cost grows steeply with board size. measured in the browser, a
13x13 board takes about 1.4s, a 14x14 anywhere from 3s to ~40s depending on the
seed, and 15x15 and 16x16 can take minutes. boards of 12 and under are effectively
instant. sizes at or above 14 get an elapsed timer and a cancel button.

### TODO

> legend:
>
> - [ ] incomplete task #with-tag-or-topic
> - [/] in progress
> - [x] complete
> - [?] unsure of status, needs investigation to determine what current status is
> - [!] won't complete
> - [i] needs investigation to determine if needed
>   - [ ] subtask (can have all status markers in [ ] as parent tasks, & can
>         have own subtasks too)

- [x] board generation module
- [x] UI to start a new game
  - [x] difficulty modifier UI
- [x] UI for giving a board size & generating a board to match
- [x] make the largest boards practical — generation discards a whole layout
      whenever refinement gets stuck, and the restart count climbs sharply past
      13 (a 14x14 needed 282 restarts in one sample)
- [x] #board-generation a difficulty modifier in board generation module that
      can influence board generation & max number of incorrect guesses allowed
      (plan: `docs/plans/board-generation-difficulty.md`) — guess-count half
      (Phase 1) done; generation-hardness half (Phase 2) still open
- [x] #keyboard-nav keyboard interaction for playing the board without a
      mouse/touch: arrow keys and/or WASD (plus vim h/j/k/l) to move a cursor
      around the grid, X to toggle an elimination mark, Q to mark a queen,
      shift+direction to extend a multi-cell selection for toggling (mirrors
      board.ts's existing shift+click range-toggle gesture), and ? to show a
      keymap reference (plan: `docs/plans/keyboard-navigation.md`)
- [/] #gameover-ui UI indicating a game was won or lost
  (plan: `docs/plans/gameover-modal-ui.md`)
  - [x] improve win UI by making it a little more celebratory, maybe add things
    like a confetti animation popping in from the sides angled up at 45ish
    degree angles then falling down behind the modal in the background
    - [x] also add score to win modal
    - [x] and if they want to share board & their completion time/score
    - [ ] confetti gravity direction follows device rotation (rotate the
          screen, gravity redirects toward the new "down", including pieces
          already mid-flight) — probably overkill/ridiculous, but planned
          (plan: `docs/plans/confetti-gravity-orientation.md`)
    - [x] streamline modal layout: score & solve time on one line, center
          header/text/button row, share button icon-only & moved inline w/
          score/time (plan: `docs/plans/gameover-modal-layout.md`)
  - [ ] if opted into leaderboard, show leaderboard ranking change w/ win ( or
        loss? needs investigation on how losses factor into score first...) &
        show placement w/in top 3-5 if in that range, otherwise show top 3-5
        above user's new ranking & score
  - [x] ask user if they want to try again on a loss
  - [ ] on first win, show special version of the win UI modal w/ extra copy
        celebrating their **first** win & introducing the leaderboard concept while
        asking if they want to opt in or not (opt in request does not require
        interaction to move on to next game & no interaction means user has not
        opted in)
- [x] share button in board view to share the current board via native share UI
  - [x] confirm works
  - [x] move to top left of board view (in same row as timer & guesses
        remaining counter UI)
- [x] start over button
  - [x] confirm starting over
  - [x] fix placement (now inline w/ new game button in the same `#below-board`
        row)
- [x] #help help button to view game rules & some strategy tips
- [x] #help skippable new user tutorial via a guided first game where modals
      appear pointing to cells/regions/UI elements explaining the following things
      (plan: `docs/plans/help.md`)
  - [x] first: how to access user profile & mentioning that's where to go to
        update user information/preferences
  - [x] then: walking through example 4x4 game from readme by pointing to
        cells, then having the user make each move -- this won't be a "real" game &
        user won't be able to make any move other than the instructed one, so that
        each situation can be observed & explained to introduce basic concepts &
        beginning strategy tips
  - [x] automatically give a fixed score boost for completion (not tied to time)
  - [x] finally: point out help button & replay affordance at end of tutorial
- [x] #user-score calculate some sort of "score" value based on board size, difficulty, &
  completion time
  - [x] determine how to score losses (are they negative? no score at all?
        number of attempts to reach a win influences score?)
  - [x] track cumulative score over time ranges (today, this week, this month,
        this year, all time) for local user history — weekly totals & an
        all-time total are done (`persistence/weeklyScore.ts`, derived from
        history rather than stored separately), surfaced in the history
        view's summary line & a per-entry running total, plus a new "Score
        over time" drawer (`scoreview.ts`) off the profile menu; today/month/
        year granularity still open. Win-modal weekly-score display is now
        done too, shown alongside per-game score.
    - [x] score-over-time view: show the trend as a line graph, not just a
          list (plan: `docs/plans/scoreview-line-graph.md`)
- [x] #user-data user profile menu button
  - [x] in the top right of the board view (in same row as timer & guesses
        remaining counter UI)
  - [x] visible even when generating a board & in top row still (e.g. spinner,
        board placeholder, & cancel button all below it)
  - [x] opens small drop-down menu for accessing information associated w/
        user, including the following:
    - [x] game history
    - [x] user preferences
    - [x] leaderboard (if opted in)
- [/] user preferences to control
  - [x] #auto-eliminate auto-eliminate row/column/region/adjacent cells when a queen is correctly guessed, toggleable in a new preferences drawer (default off) (plan: `docs/plans/auto-eliminate.md`)
  - [ ] if opted into leaderboard
  - [ ] clear local state
- [x] #history game history persistence - store history of games played in localstate
  - [x] data persistence
  - [x] history button to view previous games (located in user profile menu)
  - [x] history view (in drawer?)
  - [x] allow filtering & sorting games in history view
- [ ] #persistence resume bug: navigating to a URL for a board size that has a
      _finished_ (won/lost) save silently resumes that finished game instead
      of starting fresh — `resumableSave()` matches on size alone & doesn't
      check the saved game is still in progress. Masked in normal play since
      "New game" always goes through the options drawer rather than a raw
      `?size=` navigation, but a bookmarked/typed URL hits it.
- [x] #touch-scroll-bug on mobile/touchscreens, touch-and-drag multi-cell
      marking often triggers native page scroll instead of the drag gesture
      (existing `html { overflow-y: hidden; }` isn't sufficient on iOS
      Safari) — fixed via `touchStartedOnCell`-gated `preventDefault()`
      timing in board.ts's touch handlers, `touch-action: none` on `.cell`
      and `#board`, and `overscroll-behavior: none` on `html` (plan:
      `docs/plans/mobile-touch-drag-scroll.md`)
- [/] #user-score long term score tracking (using localstate) — see the
  cumulative-tracking subtask above; weekly + all-time done, other ranges open
  - [x] button for starting new game on same board as each history entry
  - [x] button for sharing game on same board from each history entry
- [ ] generalize start over confirmation dialog for any time user tries to
      start a new game while a current game is already active
- [x] add borders around regions
- [x] desaturate cell colors a little to leave emphasis on the marks (queen, x,
      empty)
- [ ] #timer: pause timer whenever user is in a modal/menu/drawer
- [ ] #timer: obscure game board (pixelate it maybe?) whenever timer is paused
- [x] #pregen: speed up perception of large board generation by generating boards w/ n >
      11 in the background when no other compute workers are running (plan: docs/plans/pregenerated-boards.md)
- [ ] disable board size 16 — generation time (minutes) makes it impractical
- [ ] #leaderboard _long term goal_: global leaderboard of cumulative scores
      for today & this week.
  - [ ] THIS MUST BE AN EXPLICIT OPT-IN FEATURE, defaults to users not joining
        shared leaderboard & then refrains from having users localstate store
        global leaderboard data & from sharing their data w/ leaderboard.
  - [ ] look into implementing CRDTs for holding leaderboard data between all
        users. thinking something that stores leaderboard state in user localstate
        & uses CRDT update algorithms to ensure eventual consistency when online by
        fetching updates from other online users & sharing updates as well.
        leaderboard will likely just be a single week score, user chosen username,
        location (e.g. country from user-agent), & a count of games played for each
        participating user.
  - [i] CRDTs will probably require a critical mass of users before it can
    guarantee some acceptable amount of delay in getting all updates w/out
    needing at least 1 dedicated machine always on & connected to provide data.
    will need to investigate what that critical mass may look like & how to
    tell if it's been achieved.
- [x] #undo undo button (can't undo placing queens or incorrect guesses) — marks only; a committed guess (queen or wrong) is permanent (plan: docs/plans/undo.md)
- [x] option in preferences to auto  eliminate columns, rows, & neighbors on correct queen placement (defaults to off)
- [x] BUG: share link isn't including difficulty setting
- [x] BUG: time to complete doesn't appear to factor onto score — a faster completion time should give a higher score than a slower one
- [ ] add ui to HUD that indicates how many queens have been found out of total
- [x] multiple attempts to complete should factor into score — more attempts -> lower score
- [x] incorrect guesses should factor into score — more incorrect guesses -> lower score