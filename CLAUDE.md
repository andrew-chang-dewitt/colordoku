# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — build the wasm generator, then start the Vite dev server
- `npm run build` — build wasm, typecheck (`tsc`), then production build
- `npm test` — build wasm, then run vitest
- `npm run wasm` — build just the Rust generator to wasm
- `npm run test:rust` / `npm run test:rust:release` — the generator's Rust test suite
- Run a single TS test file: `npx vitest run src/board/generate.test.ts`
- Run a single Rust test: `cargo test --manifest-path generator/Cargo.toml <name>`

**A fresh clone will not typecheck until `npm run wasm` has run at least once** —
`src/board/generate.ts` imports types from the generated `src/generator/pkg/`, which is
gitignored. Every script that runs `tsc` or `vite` builds it first. Requires a Rust
toolchain with the `wasm32-unknown-unknown` target and `wasm-pack`.

**Rebuild the wasm after changing Rust.** Running `npx vite` directly skips the
`npm run wasm` step, so the browser silently keeps the previous `.wasm`.

## Architecture

Colordoku is a "queens" puzzle game: an `n x n` grid partitioned into `n` connected
colour regions, with exactly one queen per row, per column, and per region, and no two
queens adjacent (orthogonally or diagonally). Generated boards always have exactly one
solution. Valid sizes are 1 and 4+; 2 and 3 are impossible.

The front end is vanilla TypeScript + Vite — no framework. Rendering is hand-built DOM
(`document.createElement`), not a virtual DOM.

### TypeScript side

Most modules are factory functions, each returning an object literal holding state, an
`.html` element, and mutator methods:

- `src/game/game.ts` — `newGame(size, max)`: guesses remaining, queens found, and
  `state` (`0` continuing / `1` won / `2` lost). Renders the `<ul>` of guess pips.
- `src/cell/cell.ts` — `newCell(game, group, queen?)`: one cell. `state` is `0`
  unmarked / `1` eliminated / `2` queen. A guess-committing double-click is detected via
  its own click-timestamp tracking (`DOUBLE_CLICK_MS` = 350ms confirms a guess;
  `DUPLICATE_CLICK_MS` = 50ms treats a too-fast second click as a bounced duplicate of
  the same physical click/tap and ignores it), not the native `dblclick` event — see the
  comment above those constants for why (OS-controlled timing window, inconsistent touch
  synthesis across browsers). `cell.module.css`'s `touch-action: manipulation` disables
  double-tap-to-zoom so it can't race this. Besides the click handler, `restore(state,
  frozen)` re-hydrates a cell from a `SavedGame` snapshot (bypassing the frozen guard),
  and `mark(state)` sets 0/1 externally — used by `board.ts`'s range gestures — without
  touching found/error styling or freezing the cell, so it's never mistaken for a guess.
- `src/board/board.ts` — `newBoard(size, difficulty, seed?, signal?)`, **async**. Builds the game
  HUD and the grid, sets `--board-size` inline so the CSS grid gets its column count, and
  calls `attachRangeGestures(board, cells)` to wire up multi-cell marking: shift+click a
  pair of cells toggles every non-frozen cell between them (`cellsBetween` computes that
  inclusive row/column run; a diagonal pair returns `null` and is a no-op), and touch- or
  mouse-dragging marks every cell the pointer passes over along its actual path (not
  row/column-constrained). Both gestures share a `createDragTracker()` state machine and
  take care not to double-fire cell.ts's own click handling on a cell that's actually
  part of the gesture. `attachRangeGestures` returns a dispose function (removes its
  `window`-level mouse listeners) — `newBoard()` doesn't call it (one board per page load,
  a full navigation tears everything down), but tests do, to avoid leaking a listener
  across jsdom/happy-dom's long-lived `window`.
- `src/options/options.ts` — `newOptions(config?)`: the new-game `<dialog>` (board-size
  input, clamped to `MIN_SIZE..MAX_SIZE`). `open({dismissable})` / `close()`; opened
  non-dismissable when there's no board behind it yet to fall back to (initial load with
  no `?size=`). `goToSize(size)` is the single choke point every "start a new game at
  this size" path goes through (this drawer's submit, and gameover's "New game, same
  size"): it finalizes any in-progress attempt via `history.ts`'s `closeOutInProgress()`,
  then `persistence.ts`'s `abandonGame()`, then navigates to `?size=N`.
- `src/gameover/gameover.ts` — `newGameOver({onNewGame, onChangeOptions})`: the win/loss
  `<dialog>`. `show({state, elapsedMs})` sets won/lost-specific messaging (via
  `timer.ts`'s `formatElapsed`) and opens it. Unlike `options.ts`'s drawer, Escape and
  backdrop clicks are always ignored — the player must pick one of the two actions rather
  than idle on a dead board.
- `src/timer/timer.ts` — `newTimer()`: the elapsed-time display. `start()` / `stop()` /
  `elapsedMs()`, plus `restore(elapsedMs, running)` for resuming a saved game (frozen
  display if the saved game had already ended). Auto-pauses via the Page Visibility API
  (`document.hidden` / the `visibilitychange` event) rather than window blur/focus —
  blur/focus also fires when focus moves to another app while the tab stays fully visible
  on screen (e.g. a Spotlight search), which should *not* pause the timer, whereas
  `document.hidden` only goes true when the tab is genuinely not visible. `dispose()`
  removes that listener once the timer is done with (main.ts calls it from the game's
  `onEnd`).
- `src/persistence/persistence.ts` — `SavedGame` plus `saveGame` / `loadGame` /
  `clearGame` / `abandonGame`, backed by one fixed localStorage key
  (`colordoku:save`) — a single "resume where I left off" slot, not a save-slot system.
  Stores `size` + `seed` (the layout is cheaply reproducible, see `generate.ts` below)
  plus player progress: per-cell `state`/`frozen`, guesses left, queens found, elapsed
  time, win/loss. `abandonGame()` also latches a page-lifetime `abandoned` flag so a
  stale `beforeunload`-triggered `saveGame()` — which fires *after* the synchronous
  `location.assign()` in `options.ts`'s `goToSize` has already run — can't resurrect the
  save that call just cleared.
- `src/persistence/history.ts` — `recordAttempt(size, seed, {status, elapsedMs})`,
  `getHistory()`, `clearHistory()`, backed by a separate localStorage key
  (`colordoku:history`, capped at `MAX_ENTRIES` = 500 total entries, oldest *finalized*
  ones evicted first — the in-progress entry is never evicted). Unlike `SavedGame`'s
  single overwritten slot, this accumulates one entry per *attempt* at a given (size,
  seed) board (`HistoryStatus`: `"playing"` / `"won"` / `"lost"` / `"abandoned"`) and
  entries are meant to outlive the game they describe. `closeOutInProgress()` — called
  from `options.ts`'s `goToSize`, before `abandonGame()` clears the SavedGame it reads —
  finalizes a still-`"playing"` entry as `"abandoned"` so switching boards doesn't leave a
  phantom in-progress entry behind. Nothing reads `getHistory()` back yet; it exists for a
  future "past games" view.
- `src/share/share.ts` — `buildShareUrl(size, boardId, origin, pathname)` (pure) plus
  `newShareButton({getUrl, title?, text?})`: shares the current board's
  `?size=&board-id=` link via `navigator.share` where available (mobile browsers,
  mostly — opens the native share sheet), otherwise copies to the clipboard with a brief
  on-button "Link copied!" flash. If the Clipboard API itself is unavailable (commonly an
  insecure, non-HTTPS context) or its permission is denied, it flashes the raw URL long
  enough to read/select by hand instead of leaving a dead button.

`src/main.ts` wires all of the above together: it decides options-drawer-vs-board from
`?size=`, resolves a resumable `SavedGame` for the requested size/`?board-id=`
(`resumableSave`) and re-applies it onto a freshly generated board (`cell.restore`,
`timer.restore`, `board.game.*`), and owns `persist()` — the single function that calls
both `saveGame` and `recordAttempt` on every board click plus the `visibilitychange` /
`beforeunload` "player might be leaving" signals, so both stores stay checkpointed on the
same cadence.

`src/board/generate.ts` is the bridge to the generator. `generateCells()` posts to one
or more Web Workers and maps the result through `newCell`; `cellsFromArrays()` is the
pure, separately-tested half that does the reshaping. `MAX_SIZE` is 16 because
`style.css` only defines `--color-group-0..15` — a palette limit, not an algorithm one.

Passing an explicit `seed` to `generateCells`/`newBoard` always resolves through exactly
one worker, so it's fully reproducible — that's what makes a saved game (see
`persistence.ts` above) or a `?board-id=` URL param (see `share.ts` above) reliable.
Omitting `seed` asks for a fresh board instead: at sizes at or above `SLOW_SIZE`, that
races several workers (`raceWidth`, capped by `MAX_RACERS` and scaled toward
`navigator.hardwareConcurrency`) against independently derived seeds (`deriveSeed`) and
keeps whichever finishes first, since nothing about *which* racer wins ever needs to be
reproduced — only the seed the winner actually used does, returned as
`GeneratedCells.seed`. See `generate.race.test.ts` for the pool/race orchestration tests
(fake `Worker`, no real wasm).

### Rust generator (`generator/`)

Compiled to wasm via `wasm-pack --target web` into the gitignored `src/generator/pkg/`.
No external crates; `wasm-bindgen` is a wasm-only dependency so `cargo test` does not
compile it.

- `solver.rs` — **the hot path**, ~all of the runtime. Allocation-free: `u32` bitmasks,
  fixed `[u8; MAX_N]` placements, `trailing_zeros()` to pick columns. Carries a
  region-reachability prune that is sound and order-preserving; `prune_changes_nothing_observable`
  proves it against an unpruned reference, which matters because `refine_unique` depends
  on enumeration order.
- `generate.rs` — place queens, grow regions around them, then `refine_unique` reshapes
  regions until only the intended solution survives. **Region id equals the row index of
  its seed** — load-bearing, and easy to break. `refine_unique` returns the winning
  board's *hardness* — the solver-node count of the `solve_counted` call that confirmed
  uniqueness — as a proxy for how hard the puzzle is to solve logically. `GenOptions`'s
  `Difficulty`-driven `hardness_band` (n=6..=12 only so far, see `for_size`'s doc comment
  and `examples/hardness_survey.rs` for the measurement) makes `generate_with`'s restart
  loop keep trying until a candidate's hardness lands in that tier's band — a board
  outside the band isn't invalid, just not the requested difficulty, so it's discarded
  like any other restart rather than erroring.
- `rng.rs` — hand-rolled splitmix64 + xoshiro256**, seeded from JS. Avoids
  `getrandom`'s wasm build flags and makes boards reproducible from a seed.
- `grid.rs`, `render.rs`, `error.rs`, `wasm.rs` (the only file touching wasm-bindgen).

Boards are **not** reproducible against `src/board/generator.py`, the original Python
prototype — different RNG. Determinism holds within the Rust crate.

### Performance

Generation cost grows steeply with size: 12 and under are effectively instant in the
browser, 13 is ~1.4s, 14 ranges 3–40s by seed, and 15–16 can take minutes. That is why
generation runs in a Web Worker (`src/board/generate.worker.ts`) — the call into wasm is
synchronous and would otherwise freeze the tab. Sizes at or above `SLOW_SIZE` get an
elapsed timer and a cancel button; cancelling terminates every worker involved, since the
Rust call has no interruption point.

The cost is the restart loop, not any single solve: a layout that gets stuck during
refinement is thrown away wholesale, and the restart count climbs sharply past 13. Two
mitigations for that, from a parallelism investigation (measurements and full
methodology in that investigation's notes, not checked into this repo):

- **Early abandonment** (`GenOptions::max_nodes` in `generator/src/generate.rs`):
  `refine_unique` tracks total solver nodes spent (`solver::solve_counted`) across its
  calls within one attempt and gives up on that attempt once a per-size budget is
  exceeded, rather than running to the full `refine_iters` cap. This matters because
  doomed attempts are not cheap — at n=13-16, attempts that only fail after exhausting
  `refine_iters` are ~10% of attempts but 53-65% of total CPU time, and attempt cost does
  not predict success (successful attempts are on average *cheaper* than failed ones at
  every size measured). Budgets are set per-size from direct measurement of the real
  `generate_with`, not a formula — a too-tight budget doesn't fail cleanly, it raises the
  restart count enough to be *slower* than no budget, and that crossover point did not
  move smoothly with `n` in testing. Only n=13 (5 billion nodes) and n=14 (1 billion) are
  currently tuned; n≥15 is intentionally left unbounded pending the same measurement.
- **Racing workers** (`src/board/generate.ts`): see the TypeScript-side note above.
  Real end-to-end measurement at n=14 (K independent OS processes each running the real
  `generate()`, first success wins, losers killed): ~2.8x at K=4, ~8.8x at K=8, ~22.6x at
  K=12 — clearly sublinear past K=8, which is why `MAX_RACERS` is 8.

Determinism (`same_seed_reproduces_the_board` in `generator/tests/board.rs`) is
unaffected by either change: `max_nodes` only changes how many restarts a given seed's
RNG stream needs to reach the same eventual attempt, and racing only ever picks among
independently-seeded *candidates* — a specific seed passed in always resolves
single-worker, deterministically, exactly as before.

### CSS

CSS Modules (`*.module.css`) per component, imported as `classes.xxx`. Region colours
are *global* classes composed by hand (`group-${group}` in `cell.ts`), defined in
`src/style.css` for both light and dark schemes.

## Docs

README's `### TODO` section is the single source of truth for the task backlog
(checkbox + `#tag` legend at the top of that section). `docs/plans/` holds fuller
implementation plans for individual TODO items, one file per task, referenced from the
TODO line by its `#tag` — write there when a task needs more design than a checkbox
can hold, but keep the backlog entry itself in README.

Any plan set aside for later (approved-but-deferred, or "come back to this") always
gets persisted to `docs/plans/` too, even for a spontaneous feature request with no
README TODO line yet — not left sitting only in the CLI's own single-slot plan-mode
file, which the next unrelated plan silently overwrites.
