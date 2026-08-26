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

**A fresh clone will not build until `npm run wasm` has run at least once** —
`src/generator/loader.ts` imports the compiled `src/generator/colordoku_generator.wasm`,
which is gitignored. Every script that runs `tsc` or `vite` builds it first.

Building needs **only cargo plus the `wasm32-unknown-unknown` target** — no `wasm-pack`,
no `wasm-bindgen` CLI, nothing downloaded at build time. `npm run wasm` is a plain
`cargo build` followed by a copy.

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

`src/board/generate.ts` is the bridge to the generator. `generateCells()` posts to a
worker and maps the result through `newCell`; `cellsFromArrays()` is the pure,
separately-tested half that does the reshaping. `MAX_SIZE` is 16 because `style.css`
only defines `--color-group-0..15` — a palette limit, not an algorithm one.

### Rust generator (`generator/`)

Compiled with a plain `cargo build --target wasm32-unknown-unknown --release`. **The
crate has zero dependencies** — the wasm boundary is a hand-written C ABI, not
wasm-bindgen, so no code generator has to be installed or version-matched.

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
- `abi.rs` — the wasm boundary (wasm32 builds only). Exports `generate_board(size, seed)`
  returning a status code, plus pointers into a fixed static staging buffer. The module
  **imports nothing**, so `src/generator/loader.ts` instantiates it with no glue. Results
  are staged in one reusable buffer, so the loader copies them out before the next call.
- `grid.rs`, `render.rs`, `error.rs`.

Error *messages* live in `loader.ts`, not Rust — the ABI passes status codes to avoid
marshalling strings. `abi.rs`'s constants and the loader's must stay in step.

Boards are **not** reproducible against `src/board/generator.py`, the original Python
prototype — different RNG. Determinism holds within the Rust crate.

### Performance

Generation cost grows steeply with size: 12 and under are effectively instant in the
browser, 13 is ~1.4s, 14 ranges 3–40s by seed, and 15–16 can take minutes. That is why
generation runs in a Web Worker (`src/board/generate.worker.ts`) — the call into wasm is
synchronous and would otherwise freeze the tab. Sizes at or above `SLOW_SIZE` get an
elapsed timer and a cancel button; cancelling terminates the worker, since the Rust call
has no interruption point.

The cost is the restart loop, not any single solve: a layout that gets stuck during
refinement is thrown away wholesale, and the restart count climbs sharply past 13.

### CSS

CSS Modules (`*.module.css`) per component, imported as `classes.xxx`. Region colours
are *global* classes composed by hand (`group-${group}` in `cell.ts`), defined in
`src/style.css` for both light and dark schemes.
