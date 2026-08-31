# #pregen: background pregeneration of large boards

## Overview

Boards with `n > 11` are slow to generate: size 13 ≈ 1.4s, size 14 ranges 3–40s depending on seed, size 15–16 can take minutes. This plan implements low-priority background pregeneration to speed up the player's perception of board availability.

## Approach

**One board per large size (12–15 only; 16 is disabled separately as impractically slow), pregenerated when:**
- The app starts (if no board is being actively generated)
- A board finishes generating (natural idle time)
- The player visits a board of that size (prioritize it so the next board of the same size is ready)

**Background generation is strictly LOW PRIORITY:** it uses at most one worker, never started while a foreground generation is running, and terminated synchronously the instant a foreground request arrives.

## Key facts

- `generateRawInBackground(size, difficulty)` generates a raw board (regions, queenCols, seed) in a single background worker, fully preemptible by foreground requests
- `takePregeneratedCells(game, size, difficulty)` consumes a cached board if available, removing it from storage
- Pregenerated boards are cached in localStorage under `colordoku:pregen` (max 6 boards; evicts oldest by creation time when exceeded)
- The seed is stored alongside the layout, so all downstream code (share links, resumable saves, history) continues working without changes

## Implementation files

### src/board/generate.ts
- `BackgroundPreempted` error class — thrown when foreground generation cancels a background one
- `RawBoard` interface — the output of background generation
- `isGenerating()` / `onGeneratingChange()` — foreground generation busy tracking
- `generateRawInBackground(size, difficulty)` — asynchronous raw board generation
- `cancelBackgroundGeneration()` — terminate the background worker immediately
- Updated `generateCells()` to cancel any in-flight background generation (foreground always wins)

### src/persistence/pregen.ts
New module for localStorage-backed pregenerated board cache:
- `putPregenerated(board)` — store a board, evicting oldest if needed
- `loadPregenerated(size, difficulty)` — retrieve without removing
- `takePregenerated(size, difficulty)` — retrieve and remove
- `hasPregenerated(size, difficulty)` — check existence
- Validates all stored data on read; filters out corrupt entries gracefully

### src/board/pregenerate.ts
New module for background scheduling and board consumption:
- `startPregeneration({ playingSize?, difficulty })` — start the scheduler
- `takePregeneratedCells(game, size, difficulty)` — consume a cached board if available
- `pregenSizes(playingSize?)` — returns [12..15], with playingSize first if in range
- Scheduler uses `requestIdleCallback` when available, otherwise falls back to `setTimeout`
- Respects visibility API (pauses when tab hidden); respects foreground generation (backs off)
- Tracks failures per size; gives up after 3 failures

### src/board/board.ts
- Updated `newBoard()` to check for pregenerated boards before calling `generateCells`
- If a pregenerated board exists and no explicit seed is passed, use it immediately

### src/main.ts
- Calls `startPregeneration({ difficulty })` when showing the options drawer (no board yet)
- Calls `startPregeneration({ playingSize, difficulty })` after a board is successfully set up

## Test coverage

- `src/persistence/pregen.test.ts` — localStorage round-trip, eviction, corrupt data handling
- `src/board/pregenerate.test.ts` — scheduler behavior, pure `pregenSizes()` function
- `src/board/generate.race.test.ts` — extended with:
  - `isGenerating()` / `onGeneratingChange()` busy tracking
  - `generateRawInBackground()` single-worker generation
  - Background preemption by foreground requests
  - `cancelBackgroundGeneration()` isolation

## Constraints and guarantees

- **No pool pollution:** background workers are never added to the global foreground pool; a blocked background worker could queue a foreground postMessage behind it
- **Instant preemption:** `cancelBackgroundGeneration()` runs synchronously; foreground generation never waits
- **No crashes on storage failure:** all localStorage reads/writes wrapped in try/catch; failures swallowed
- **Graceful degradation:** if pregeneration fails 3 times for a size, it stops trying; the board still generates on demand
- **No stale backgrounds:** `onGeneratingChange()` listener automatically backs off when foreground work resumes

## Size range: 12–15

- 12–13 are "nice to have" but not critical (under 2s)
- 14 is the real target (3–40s becomes instant if pregenerated)
- 15 is valuable but rare (minutes become instant)
- 16 is disabled separately; not worth the cell-count cost in tests

## Future improvements

- Measure hardness of pregenerated boards; prefer difficulty-matched puzzles
- Tune `START_DELAY_MS`, `GAP_MS`, `RETRY_MS` based on real browser idle patterns
- Surface pregeneration progress in the UI if desired
