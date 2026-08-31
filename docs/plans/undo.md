# Undo Button — Implementation Plan

## Overview

Implemented an undo button that allows players to revert elimination marks (free 0↔1 state toggles) on non-frozen cells. The button is positioned in the HUD alongside the guess-pips counter, and is activated via the on-screen button or keyboard shortcut Ctrl+Z / Cmd+Z.

## Key Constraint

**Undo covers ONLY free elimination marks.** It can NEVER undo a committed guess, whether that guess placed a queen (correct) or was wrong. Once a cell is frozen by a double-click/double-tap commit or keyboard Q, it is permanent and outside undo's reach for the rest of the game.

This constraint is the load-bearing assumption for the entire design: since guesses are never undoable, the undo stack is purely a session-in-progress convenience, never persisted to localStorage. A page reload starts with an empty undo stack.

## Architecture

### New Module: `src/undo/undo.ts`

Exports three functions:

- **`newUndoStack(cells)`**: Creates a session-only undo stack for a grid of cells. Installs `onMark` and `onFreeze` hooks on every cell:
  - `onMark(previous)`: Called *before* a mark/unmark changes state (0 ↔ 1), passing the previous state. Used to record free marks.
  - `onFreeze()`: Called the moment a cell becomes frozen (committed guess or restored from save). Removes all stack entries referencing that cell — critical for handling the double-click edge case where the first click marks, then the second click commits on the same cell. Without this cleanup, an undoable "mark" would be left behind that references a now-frozen cell.

- **`newUndoButton(undo)`**: Creates the HUD button. Disabled when the stack is empty, enabled when marks are recorded, and disables again after the last undo.

### Hooks in `src/cell/cell.ts`

Two optional callbacks on the `Cell` interface:

- **`onMark?: (previous: 0 | 1) => void`**: Fired by `toggle()` and `mark()` when the state actually changes. NOT called by `commit()` (guesses are never undoable) or `restore()` (rehydrating a save must never be undoable).

- **`onFreeze?: () => void`**: Fired by `commit()` immediately after `cell.frozen = true`, and by `restore(state, true)` when restoring a frozen cell. Signals that this cell is now permanently outside undo's reach.

### Integration in `src/board/board.ts`

The undo stack is wired into every gesture that marks cells:

1. **Mouse drag** and **touch drag**: Both multi-cell drags are bracketed as single undo transactions via the `createDragTracker()` state machine (`begin()` at drag start, `end()` at drag end).

2. **Shift+click range**: The loop marking cells in the range is bracketed as a single transaction.

3. **Keyboard shift+direction range selection**: When Shift is first pressed, `begin()` is called. The transaction closes either when Shift is released (`keyup` handler calls `end()`) or when a non-Shift movement key is pressed (breaking the selection).

4. **Ctrl+Z / Cmd+Z**: Added as a gated keyboard handler AFTER all existing gates (dialog open, game ended, form field focused), so it inherits all gating rules automatically. Shift+Ctrl+Z is explicitly left alone (no redo).

### HUD Layout (`src/board/board.ts` → `src/style.css`)

The HUD was restructured to contain a `#hud-row` flex container holding both the guess-pips `<ul>` and the undo button side-by-side with 0.75rem gap. This keeps both controls visually grouped as related game chrome.

### Persistence (`src/main.ts`)

- Undo stack is NOT persisted to localStorage — `SavedGame` has no undo data field, so reloads always start with an empty stack.
- The stack is explicitly cleared at game end (`board.game.onEnd(() => undo.clear())`), so the button visibly disables once the game is won/lost.
- Undo operations trigger persistence via `board.undo.onApply(persist)`, ensuring the board state after an undo is checkpointed to localStorage in the same transaction as any other board mutation.

### Help Text (`src/help/help.ts`)

Keyboard shortcut reference was updated with: `{ keys: "Ctrl + Z", action: "Undo last mark (not guesses)" }`.

## Why No Changes to game.ts, persistence.ts, or gameover.ts

- **game.ts**: Undo only toggles cell states 0 ↔ 1 on non-frozen cells. No `guessesLeft` / `queensFound` counter is affected, so no game-state changes needed.
- **persistence.ts**: `SavedGame` already stores per-cell `state` and `frozen`. Undo produces exactly the same cell states a real player's manual toggles would, so existing `saveGame()` naturally captures the result.
- **gameover.ts**: The modal's own gates (blocked at game end by `attachKeyboardNavigation`'s Gate 2) plus the explicit `undo.clear()` on game end make the button unreachable and disabled by construction.

## Testing

Comprehensive test coverage in:

- **`src/undo/undo.test.ts`** (23 tests): Undo stack itself — recording, transactions, committed-guess edge case, button state.
- **`src/cell/cell.test.ts`** (extension): Hooks fire only in correct contexts (`mark()` / `toggle()` fire `onMark`; `commit()` / `restore(true)` fire `onFreeze`; never when they shouldn't).
- **`src/board/board.test.ts`** (extension): Gesture transactions — mouse drag, touch drag, shift+click, keyboard shift+direction all create single undo entries; keyboard Ctrl+Z respects all gates; keyboard Q commits are never undoable.

## Transaction Model

The `begin()` / `end()` pair allows marking multiple cells as a single undo entry. Used by gestures to make drag-marking or range-selection a one-undo operation rather than recording each cell separately. Within a transaction, if a cell is marked multiple times, its earliest "previous" value is retained for undo.

## Non-Persisted Design Rationale

Undo is a session-in-progress convenience, not a core game feature. Unlike saved-game resumption (which requires reliable recovery across page reloads), undo is purely about immediate correction during active play. A reload naturally ends any attempt; there's no expectation of resuming undo state into a new session. Keeping it session-only simplifies the model and avoids localStorage bloat.
