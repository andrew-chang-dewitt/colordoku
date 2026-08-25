# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — typecheck (`tsc`) then production build via Vite
- `npm run preview` — preview production build
- `npm test` — run vitest (with typechecking enabled: `vitest --typecheck`)
- Run a single test file: `npx vitest run <path-to-test>` (no test files exist yet)

## Architecture

Colordoku is a "queens" puzzle game (color-region grid where you mark/eliminate cells to find one queen per color group and per row/column) built with vanilla TypeScript + Vite — no framework. Rendering is done by hand-constructing DOM elements (`document.createElement`), not via any virtual DOM.

Three factory-function modules compose the app, each returning a plain object literal with both state and a `.html` element reference plus mutator methods:

- `src/game/game.ts` — `newGame(size, maxGuesses)` tracks overall game state: guesses remaining, queens found, win/loss state (`0` continuing / `1` won / `2` lost). Renders a `<ul>` of guess-pip `<li>`s that `update()` marks as used.
- `src/cell/cell.ts` — `newCell(game, group, queen?)` represents one board cell. `state` is `0` not-marked / `1` eliminated / `2` queen-found. Click handlers are attached directly to the cell's button element: single-click toggles eliminated, double-click commits a guess (correct → freezes as found queen and calls `game.incFound()`; incorrect → freezes as an error and calls `game.incGuess()`). Once `frozen`, a cell no longer responds to clicks.
- `src/board/board.ts` — `newBoard(size)` builds the grid of cells and assembles the game HUD + board into one container. **Currently hardcoded**: always builds a fixed 4x4 board with a hardcoded color-group/queen-position layout regardless of the `size` argument passed in (see the `_size` param and the comment above the `cells` array). `newGame(4, 3)` is likewise hardcoded inside.

Entry point `src/main.ts` mounts `newBoard(4)` into `#app`; the `4` argument is currently a no-op (see `FIXME` comment).

CSS Modules (`*.module.css`) are used per-component (`cell.module.css`, `game.module.css`) and imported as `classes.xxx`; class names are also composed by hand (e.g. `group-${group}` for color-coding cells), so board color themes live in plain CSS, not the modules.

This is an early-stage proof of concept (see the single commit `feat(poc): build single 4x4 game proof of concept`): board generation is not yet dynamic, and there is no puzzle-generation/solver logic yet — the 4x4 layout and queen placements in `board.ts` are hand-authored.
