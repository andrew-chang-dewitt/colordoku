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

Three factory-function modules, each returning an object literal holding state, an
`.html` element, and mutator methods:

- `src/game/game.ts` — `newGame(size, max)`: guesses remaining, queens found, and
  `state` (`0` continuing / `1` won / `2` lost). Renders the `<ul>` of guess pips.
- `src/cell/cell.ts` — `newCell(game, group, queen?)`: one cell. `state` is `0`
  unmarked / `1` eliminated / `2` queen. Single-click toggles eliminated; double-click
  commits a guess, then freezes the cell either way.
- `src/board/board.ts` — `newBoard(size, seed?, signal?)`, **async**. Builds the game
  HUD and the grid, and sets `--board-size` inline so the CSS grid gets its column
  count.

`src/board/generate.ts` is the bridge to the generator. `generateCells()` posts to one
or more Web Workers and maps the result through `newCell`; `cellsFromArrays()` is the
pure, separately-tested half that does the reshaping. `MAX_SIZE` is 16 because
`style.css` only defines `--color-group-0..15` — a palette limit, not an algorithm one.

Passing an explicit `seed` to `generateCells`/`newBoard` always resolves through exactly
one worker, so it's fully reproducible — that's what makes a saved game (see
`persistence.ts`) or a `?board-id=` URL param reliable. Omitting `seed` asks for a fresh
board instead: at sizes at or above `SLOW_SIZE`, that races several workers (`raceWidth`,
capped by `MAX_RACERS` and scaled toward `navigator.hardwareConcurrency`) against
independently derived seeds (`deriveSeed`) and keeps whichever finishes first, since
nothing about *which* racer wins ever needs to be reproduced — only the seed the winner
actually used does, returned as `GeneratedCells.seed`. See `generate.race.test.ts` for
the pool/race orchestration tests (fake `Worker`, no real wasm).

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
  its seed** — load-bearing, and easy to break.
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
