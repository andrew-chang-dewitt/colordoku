# #keyboard-navigation: full keyboard play

Scope: a keyboard-movable cursor over the board grid, with arrow/WASD/vim
(hjkl) movement, X to toggle an elimination mark, Q to commit a guess (the
keyboard equivalent of cell.ts's double-click-to-commit gesture),
Shift+direction to extend a range-mark selection mirroring the existing
shift+click gesture in `attachRangeGestures`, and a `?`-triggered help
overlay listing the bindings.

Not in scope: touch/mouse gesture changes (none needed — this is additive),
real accessibility semantics beyond what's noted in "Accessibility" below,
and any change to `attachRangeGestures`'s existing mouse/touch behavior.

## Phase structure

**One phase, not split.** The board-generation-difficulty plan splits
phases where "core" and "nice-to-have extension" are genuinely separable
pieces of value a player could ship independently. Here every piece in the
requirements list depends on the same foundation (a cursor position, a
single keydown listener, a direction-resolution function) and the
requirements list itself was handed down as one feature, not two. Cutting
it at, say, "movement + X/Q" vs. "shift-range + help overlay" wouldn't
reduce implementation risk (the range-select logic is a thin adapter over
code that already exists and is already tested) and would just leave the
feature half-usable — a player who can move and mark but can't select a
range or find the keymap is a worse intermediate state than shipping the
whole small feature at once. Estimated footprint (one new module + a handful
of touch points in board.ts/cell.ts/main.ts + one new dialog component) is
in the same size class as gameover-modal-ui.md's single-phase scope, not
board-generation-difficulty.md's two-phase one (which split because Phase 2
there was a genuinely separate, much larger, still-unmeasured algorithmic
change).

## Design decisions

### 1. Cursor state: where it lives, how it's represented, lifecycle

Lives in **board.ts**, not a new module. Reasoning: the cursor is
fundamentally board-shaped state (a `{row, col}` pair into `cells`), and
board.ts is already the place that owns whole-grid concerns that don't fit
in cell.ts (`attachRangeGestures`, `cellsBetween`, `applyRegionBoundaries`)
for exactly the same "only board.ts sees the whole grid" reason documented
on `attachRangeGestures`'s doc comment. A separate `src/cursor/cursor.ts`
module would need to import `Coord`, `cellsBetween`, and reach back into
`cells` anyway — there's no independent concern here worth its own file and
its own test file, unlike e.g. `timer.ts` (a real independent clock
abstraction reused nowhere else).

Concretely, add a new exported function to board.ts:

```ts
export function attachKeyboardNavigation(
  board: HTMLDivElement,
  cells: Cell[][],
  game: Game,
  helpOverlay: HelpOverlay, // see design decision 6
): () => void
```

wired from `newBoard()` the same way `attachRangeGestures` is (called
unconditionally inside `newBoard()`, unlike `attachRangeGestures` whose
dispose fn `newBoard()` itself doesn't call — see decision on disposal
below for why this one's dispose *does* get called by `newBoard()`-adjacent
code).

Representation: a plain `{ row: number; col: number }` (reuse board.ts's
existing exported `Coord` type — no new type needed), held in a closure
variable inside `attachKeyboardNavigation`, not on the `Board` interface.
Nothing outside this function needs to read cursor position — the focus
visual is applied directly to the relevant cell's `html` element as a
side effect of moving, so there's no reason to widen `Board`'s public
shape for it (consistent with `attachRangeGestures`'s own drag state
being fully private to that function).

**Default position on initial load:** `{ row: 0, col: 0 }` (top-left), not
center. Reasoning: it's the simplest, most predictable default, matches
how a screen reader / keyboard user would expect a grid's "first" cell to
be top-left (reading order), and avoids a size-dependent floor/ceil
calculation for a "center" cell on even-sized boards (which has no single
correct answer — 4 candidate center cells on an 8x8) for no clear benefit.

**Across a board regeneration / new game:** moot — a new game is always a
full page navigation in this codebase (`goToSize`/`startOver` both call
`location.assign`, per options.ts's doc comments), so `attachKeyboardNavigation`
is always called fresh on a freshly-built `cells` grid with a fresh
top-left default. No cursor state crosses a regeneration boundary, and none
needs to: there's no in-place "generate a new board without navigating"
path anywhere in this codebase today.

**Not persisted.** `persistence.ts`'s `SavedGame` is not extended to store
cursor position. A resumed game (`saved !== null` in main.ts) re-hydrates
cell state/frozen but always starts keyboard focus at `{0,0}` same as any
fresh load — cursor position is transient UI state, not player progress,
the same category distinction persistence.ts already draws between saved
`cells[r][c].state/frozen` (progress) and things it deliberately doesn't
save (e.g. scroll position). Keeps this feature's footprint out of
persistence.ts entirely.

**Visual focus style:** see decision 7 below for the concrete CSS.

### 2. Key handling scope: where the listener attaches

**Document-level listener, gated by "board's game not yet ended AND no
dialog currently open,"** not a listener on the board element with
`tabindex`.

Justification: cell.ts's cells are real `<button>` elements, each
independently focusable and each with its own native `click`-driven
handling; there's no single "the board has focus" state to hang a
board-level listener off without also fighting native button focus/Tab
order, and giving the board container itself a `tabindex` would insert an
extra, confusing Tab stop that does nothing on its own (activating it
doesn't do anything; the interesting keys are the letter/arrow keys, not
Enter/Space). A `document`-level `keydown` listener sidesteps that: it
doesn't require the board to hold focus at all, matching how a player
naturally starts keyboard play (arrow-key-down without first clicking a
cell to focus it) and matching the "global keyboard shortcut" shape already
used nowhere else in this codebase but common for this genre of game (this
is closer to a video-game input model than a form-focus model, and the grid
has no natural document focus order for Tab to helpfully assign anyway).

Gating, checked at the top of the document `keydown` handler before doing
anything else:

- **`game.state !== 0`** (game already won/lost): ignore all navigation/
  action keys. `?` (help) still works — reading the keymap after a game
  ends is harmless and arguably still useful (e.g. before hitting "Try
  again"). Mirrors gameover.ts's own modal already having taken over
  interaction at that point via `showModal()`'s native inertness — but this
  listener has no way to *know* that dialog is showModal-open other than
  checking `game.state`, since it's document-level and dialogs are siblings
  in the DOM, not ancestors of the board; checking `game.state` directly is
  simpler and exactly as correct (the two are set at the same moment: `onEnd`
  fires synchronously off the same state transition gameover.ts's `show()`
  responds to).
- **Any `<dialog>` on the page is open** (`options.html.open ||
  gameOver.html.open || helpOverlay.html.open`): ignore all keys, full stop
  — including `?`, since the options drawer's size `<input>` needs to
  receive ordinary typed characters (a size like "16" typed with number keys
  is unaffected either way, but the drawer could plausibly gain more text
  fields later, and "any open dialog wins" is the simplest rule that can't
  be broken by a future field). Concretely: `attachKeyboardNavigation`
  receives the three dialogs' `.html` elements (or a single `() => boolean`
  "is any dialog open" callback built once in main.ts and passed down,
  preferred — see Files touched) and checks it first, before the `game.state`
  check above.
- **`document.activeElement` is a form field** (`INPUT`/`TEXTAREA`/
  `SELECT`, or has `isContentEditable`): ignore all keys too, as a second
  independent guard — the open-dialog check above already covers the
  options drawer's own input in practice, but a raw `document.activeElement`
  check is a cheap, robust belt-and-suspenders guard against any future text
  field appearing anywhere on the page outside a dialog, and costs nothing.
- Otherwise, key is live. `Escape` is deliberately **not** claimed by this
  listener for anything — no cursor-clearing behavior is defined for it (see
  requirements list; Escape isn't mentioned), so it simply falls through
  unhandled, which also means it can't ever fight a dialog's own `cancel`
  event handling.
- **Tab, browser find-in-page (Ctrl+F), and all keys not in the bindings
  table are left completely unhandled** — the listener only calls
  `preventDefault()` on keys it actually recognizes as a binding (arrows,
  WASD, hjkl, X, Q, Shift+ combos, ?), so nothing else on the page is ever
  affected. Arrow keys specifically **do** need `preventDefault()` even
  though the page doesn't scroll (board fits on screen in the common case) —
  cheap and correct defensively for a tall/zoomed board where arrow-key
  page-scroll would otherwise fight cursor movement.

This function is wired up once from `newBoard()` (mirroring where
`attachRangeGestures` is called) but needs the "is any dialog open" and
`game` values which `newBoard()` doesn't have visibility into beyond `game`
itself (which it does construct) — see Files touched for how the
open-dialog predicate crosses that boundary from main.ts.

### 3. Movement: unified direction resolution, clamping

One small pure function, colocated in board.ts near `cellsBetween`:

```ts
export type Direction = "up" | "down" | "left" | "right";

/** Resolves a keydown's key to a cursor direction, or null if it's not a movement key.
 * Covers arrows, WASD, and vim h/j/k/l as three equally-valid input styles —
 * checked case-insensitively for the letter keys so Caps Lock doesn't break it. */
export function directionFor(key: string): Direction | null {
  switch (key) {
    case "ArrowUp": case "w": case "W": case "k": case "K": return "up";
    case "ArrowDown": case "s": case "S": case "j": case "J": return "down";
    case "ArrowLeft": case "a": case "A": case "h": case "H": return "left";
    case "ArrowRight": case "d": case "D": case "l": case "L": return "right";
    default: return null;
  }
}
```

Movement always moves exactly one cell per keypress (no key-repeat
acceleration/multi-cell jump — out of scope, holding the key down relies on
the OS's native keyrepeat to re-fire `keydown`, which is sufficient and
needs no special handling here).

**Clamping, not wraparound.** At a grid edge, a direction that would leave
the grid is a no-op (cursor stays put) rather than wrapping to the opposite
edge. Justification: wraparound is a plausible alternative (some
grid-based games do it) but has no basis in this feature's requirements,
and clamping is the less surprising default — it matches how a text cursor
or a `<select>` list behaves at its bounds, and avoids a disorienting jump
a player didn't ask for. Nothing about the shift+range-select gesture (a
straight row/column run — see decision 4) is compatible with wraparound
either, since `cellsBetween` has no concept of a wrapped range; picking
wraparound for plain movement would create an inconsistency between how
plain and shift-held movement behave at an edge, which clamping avoids for
free.

### 4. Shift+direction range selection: reusing `cellsBetween`

The mouse gesture's shape (from board.ts, already read in full): a
**two-click anchor-then-close-the-range** model — first shift+click sets an
`Anchor {coord, value}` capturing the anchor cell's polarity, a second
shift+click computes `cellsBetween(anchor.coord, coord)` and marks the
inclusive run to the opposite of the anchor's captured value, then rolls
the anchor forward to the just-clicked cell so a third shift+click extends
further.

Keyboard shift+direction only ever moves **one cell at a time** in a
single direction — never a diagonal jump, never a multi-cell jump — so
there is no diagonal case to resolve for the keyboard gesture the way
`cellsBetween` has to reject one for two arbitrary shift-clicked points:
every single keyboard shift+direction step is definitionally either
horizontal or vertical, exactly the two cases `cellsBetween` already
handles, and `cellsBetween` never sees a diagonal input from this call
site at all. (The mouse version's diagonal no-op case matters there because
two shift+clicks can land on genuinely arbitrary, unrelated cells; the
keyboard analog can't produce that input shape by construction.)

Concretely, the keyboard gesture is modeled as a **continuously held
anchor**, not the mouse's two-click-then-close-then-roll-forward model,
because a keyboard selection is naturally a "hold Shift, tap direction
repeatedly, release Shift" gesture (like text selection with Shift+Arrow in
any text editor) rather than a "two discrete clicks" one:

- On the **first** movement keypress where `event.shiftKey` is true *and*
  no keyboard-selection anchor is currently active, capture the anchor at
  the cursor's *current* (pre-move) position — same `{coord, value}` shape
  as the mouse `Anchor` interface (reuse it; export it from board.ts if it
  isn't already — currently it's a private `interface Anchor` in board.ts,
  so this is the one piece of currently-private surface that needs
  exporting, see Files touched), with `value` read from the current cell's
  `state` the same way the mouse handler does (`cell.state === 1 ? 1 : 0`,
  and refused — no anchor set, gesture inert — if the current cell is
  frozen, mirroring the mouse gesture's own frozen-anchor refusal).
- The cursor then moves one cell in the pressed direction (clamped as
  usual), and `cellsBetween(anchor.coord, newCoord)` is computed and every
  non-frozen cell in that inclusive run is `mark()`ed to the opposite of
  `anchor.value` — reusing `cellsBetween` and `Cell.mark()` exactly as the
  mouse path does, no reimplementation.
- **Every subsequent** shift+direction keypress, while Shift is still being
  held across repeated presses, **recomputes** the range from the *same*
  anchor to the cursor's new position (not "roll the anchor forward" the
  way the mouse's second-click does) — this is the one deliberate
  divergence from the mouse gesture's exact mechanics, justified because a
  live-extending selection (grow/shrink a single range as arrows are
  pressed, anchor fixed until Shift releases) is the correct semantic for a
  held-modifier gesture and matches every text-editor Shift+Arrow selection
  model; "roll the anchor forward on every step" would instead mark a
  brand-new one-cell-at-a-time range on every keypress and never let the
  player shrink a selection by reversing direction, which would feel broken
  by comparison. Before applying the new range, the *previous* range (a
  `Coord[]` kept in the same closure) is unmarked back to `anchor.value`
  wherever a cell isn't now also part of the new range and isn't frozen —
  i.e. this needs its own small "diff old run vs new run" step that the
  mouse code doesn't need at all (it never revisits a run). Simplest correct
  approach: recompute the full range from the anchor every keystroke,
  compute the symmetric difference against the previously-applied range,
  reset the removed cells to `anchor.value` and set the newly-included ones
  to the opposite — both are single-pass `Set<string>` diffs over
  `Coord[]`, same key-encoding trick (`` `${row},${col}` ``) already used in
  `createDragTracker`'s `marked` set.
- On **`keyup` of Shift** (or on any movement keypress that arrives without
  `shiftKey` — i.e. the player moved without holding Shift, implicitly
  ending the selection), the anchor and last-applied-range state are
  cleared. No further "commit"/finalize step is needed — the marks are
  already live/applied at every intermediate step, matching how the mouse
  drag gesture also marks live as the pointer moves (not only at drag end).
- X and Q while a keyboard range-selection is active: **X still applies to
  the single cursor cell only**, not the whole selected range — the
  requirements list defines X as "toggles an elimination mark on the
  cursor's cell" (singular), distinct from the Shift+direction gesture's
  own separate whole-range toggle that already happens automatically as the
  selection is extended. This mirrors the mouse gesture too: a plain click
  (X's mouse equivalent) is explicitly left alone by `attachRangeGestures`'s
  own click listener and never treated as a range operation. Q (commit a
  guess) is unaffected by an active selection either way — see decision 5.

This lives as new logic inside `attachKeyboardNavigation` in board.ts,
calling the exported `cellsBetween` and the newly-exported `Anchor` type,
and `Cell.mark()` — no changes needed to `attachRangeGestures` itself, and
no changes to `createDragTracker` (decision 8 covers why it's not reused).

### 5. X and Q key handling

**X** calls the cursor cell's own `toggleMark()`-equivalent behavior — but
`toggleMark` is a private closure function inside `cell.ts`'s `newCell`,
not exposed on the `Cell` interface, and reusing it directly isn't
possible without changing cell.ts's public surface. Two options:

- (a) Add a new exported method to the `Cell` interface, e.g.
  `toggle(): void`, extracting the existing private `toggleMark` body
  (already exists verbatim inside `newCell`) so both the click handler and
  the new keyboard path call the same one function; or
- (b) Reuse the existing `mark(state)` — explicitly wrong per this file's
  own doc comment ("must not be mistaken for a guess" is about the commit
  path, but more precisely: `mark` is designed for *external, gesture-driven*
  0/1 sets to a *specific target* value across a range, not a *toggle* of a
  single cell — using it for X would require the caller to compute
  `cell.state === 1 ? 0 : 1` itself, which is exactly what `toggleMark`
  already encapsulates).

**Pick (a).** It's the smaller, more correct change: `toggle()` becomes a
one-line addition to the `Cell` interface plus renaming the call sites of
the existing private `toggleMark` inside `newCell` to `cell.toggle =
toggleMark` (or simply have the object literal's `toggle` property call the
existing free function, same pattern `restore`/`mark` already use as methods
that close over the free `html`/`classes` bindings) — no behavior change to
existing click handling at all, purely exposing what already exists.
`cell.ts`'s own frozen guard for X: `toggle()` should check `this.frozen`
and no-op if frozen, mirroring `handleClick`'s own `if (cell.frozen)
return;` at its top — currently `toggleMark` itself has no frozen check
(callers are trusted to have already checked, per `handleClick`), so the
new `toggle()` method needs to add that guard itself since it's now a
directly-callable public entry point that `attachKeyboardNavigation` will
call without any surrounding guard of its own.

**Q** triggers the actual commit-guess path — same effect as two rapid
clicks. `commitGuess()` is also a private closure function inside `newCell`.
Same treatment: expose it as `Cell.commitGuess(): void` (or a differently-
named public wrapper, e.g. keep the interface method named `commit()` for
symmetry with `toggle()`), with the **exact same body**, including the
`setTimeout(fn, 0)` deferral around `game.incFound()`/`incGuess()` —
this is explicitly called out in the requirements as load-bearing (fixes a
real paint-lag bug) and must not be special-cased away for the keyboard
path; the keyboard path gets it for free by calling the identical function,
not a reimplementation. Frozen guard: same as `toggle()` — `commit()` no-ops
if `cell.frozen` is already true, mirroring `handleClick`'s guard, since Q
on an already-frozen/already-guessed cell has nothing left to commit.

Both `toggle()` and `commit()` act on **the cursor's cell only** — `cells[cursor.row][cursor.col]`
— read directly by `attachKeyboardNavigation`'s keydown handler, not routed
through any DOM event synthesis (no need to dispatch a synthetic `click`
event at the cell — calling the new public methods directly is simpler and
avoids re-deriving the double-click timing state machine for a key that has
no "second press within N ms" ambiguity to resolve in the first place; Q is
unambiguous on a single press).

### 6. `?` key: help/keymap overlay

New small module: **`src/help/help.ts`** (mirrors `src/options/options.ts`'s
`<dialog>` drawer pattern, per the codebase's existing per-feature-folder +
sibling `.module.css` convention — see `src/gameover/`, `src/options/`,
`src/startover/` for the established shape).

```ts
export interface HelpOverlay {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
}

export function newHelpOverlay(): HelpOverlay
```

Content: a static table/list of the bindings — movement (arrows / WASD /
hjkl), X (toggle elimination mark), Q (commit guess), Shift+direction
(extend range mark) — built once at construction time, no dynamic state.

**Dismissable via Escape and backdrop click** — the opposite of
gameover.ts's modal, and justified oppositely too: gameover.ts is a forced
choice ("you must pick Try again / Change size / New game, nothing else
makes sense"), whereas the help overlay is a transient reference the player
opens mid-game and wants to dismiss quickly to get back to playing,
identical in spirit to options.ts's drawer being dismissable once there's a
board behind it (`dismissable: true` case) — reuse that exact pattern:
`html.addEventListener("cancel", ...)` doesn't call `preventDefault()`, and
a click handler closes on `event.target === html` (backdrop) the same way
options.ts's own drawer does. No `dismissable: false` mode is needed here at
all (unlike options.ts, which needs one for the "no board yet" case) — the
help overlay is only ever opened from an already-playable board, so it's
unconditionally dismissable.

**Timer interaction: does not pause the timer.** `timer.ts`'s auto-pause is
explicitly tied to Page Visibility (`document.hidden`), not to any modal
being open — opening a `<dialog>` does not hide the document, so today
*no* existing modal (options drawer reopened mid-game, gameover) pauses the
timer via that mechanism either (gameover's timer.stop() is called from
`onEnd`, not from the modal opening). Consulting a keymap reference is a
"paused-in-spirit" action a player might reasonably want *not* to cost them
elapsed time, but adding new pause/resume plumbing to `timer.ts` for this
one dialog is a scope increase beyond what's asked (the requirements list
only says "opens a keymap/help reference," not "pauses the game") — **left
out of scope deliberately**, noted here so it isn't silently forgotten:
the timer keeps running while the help overlay is open, exactly as it does
today while the options drawer is reopened mid-game.

`?` is reachable via `Shift+/` on a standard layout — `event.key` reports
`"?"` directly on browsers/layouts where Shift+/ produces it, so the
handler matches on `event.key === "?"` (not a raw code check for Shift and
`/` separately), consistent with `directionFor`'s use of `event.key` for
everything else. Opening the overlay works regardless of `game.state`
(decision 2's gating explicitly special-cases `?` to remain live even after
the game ends) but — same as every other binding — is itself suppressed
while another dialog is already open (decision 2's "any dialog open" gate
is checked first, before dispatching to any specific key including `?`,
so `?` typed while the options drawer or gameover modal is open does
nothing, not stack a second dialog on top).

### 7. Accessibility

Cells are already real `<button>` elements, which is a solid foundation,
but this plan **deliberately does not** attempt full assistive-tech
correctness (e.g. `aria-live` announcements of cursor position/cell
contents, roving `tabindex` so screen-reader users can Tab through the grid
the "correct" ARIA-grid way, `aria-selected` on a range-marked run) — none
of that is in the requirements list, and doing it properly is a
meaningfully sized separate effort (ARIA grid pattern has real subtlety
around `role="grid"`/`role="gridcell"`, roving tabindex, and live-region
announcement timing that would need its own design pass and testing with
actual AT). What this plan *does* do, cheaply, alongside the visual focus
style (decision 1 above / CSS below):

- The cursor cell gets `aria-current="true"` set/cleared as the cursor
  moves (cleared on the previously-current cell, set on the new one) — a
  single extra DOM attribute write alongside the existing className
  toggle for the focus ring, and a real (if minimal) accessibility signal
  a screen reader can pick up, at effectively zero implementation cost.
- Nothing else. Explicitly deferred; if real screen-reader support for
  the board becomes a goal, it should be its own `docs/plans/` entry.

### 8. Interaction with the existing drag gesture's `createDragTracker`

**Wholly separate state**, not reused. `createDragTracker()`'s state
machine (`target`/`start`/`moved`/`marked`) is shaped specifically around
*pointer* semantics — "begin" at a hit-tested DOM point, "move" to another
hit-tested point along an arbitrary path, "end" on pointer-up, with the
`marked` `Set` existing to make an arbitrary, possibly self-crossing
pointer path idempotent. The keyboard gesture (decision 4) has none of
that shape: it moves in discrete single-cell steps along a single row/
column only, needs to *shrink* a selection (unmark cells that fall out of
range) which `createDragTracker` never has to do (a pointer path only ever
grows `marked`, never un-marks), and has no "hit-testing a DOM point" step
at all since it always knows its own coordinates directly. Trying to
squeeze the keyboard gesture through `createDragTracker`'s interface would
mean adding shrink/un-mark support to a state machine that's proven simple
specifically *because* it never needs that — not worth compromising the
existing, well-tested code for a superficial "shared abstraction" that
doesn't actually fit. The two gestures do share the *lower-level* pieces
that are already reusable on their own merits — `Coord`, `cellsBetween`,
`Cell.mark()` — which is the right amount of sharing.

They also don't need to coordinate/conflict-guard against each other at
runtime: a mouse drag and a keyboard shift-selection can't physically
happen at the same instant from the same input device, and if a player
somehow has both a mouse button down and is pressing shift+arrow keys
simultaneously, the two gestures simply both apply their own `mark()` calls
to whatever cells they each touch — `mark()` is idempotent and stateless
per-call, so this isn't a race that can corrupt anything, just a rare and
harmless overlap.

## Files touched

- **`src/board/board.ts`**
  - Export the currently-private `interface Anchor` (decision 4).
  - Add `export type Direction` and `export function directionFor(key: string): Direction | null` (decision 3).
  - Add `export function attachKeyboardNavigation(board, cells, game, isAnyDialogOpen): () => void` — cursor state, focus visual application, X/Q dispatch, shift+direction range logic (decisions 1-5, 7). Returns a dispose function (removes the `document`-level `keydown`/`keyup` listeners) — same pattern as `attachRangeGestures`'s returned disposer, for the same test-isolation reason (see Test impact).
  - Adjust `newBoard()`'s signature: it currently has no way to know about `options`/`gameOver`/the new `helpOverlay`'s open state, all of which are constructed in **main.ts**, outside `newBoard()`. Two options: (i) have `newBoard()` accept an `isAnyDialogOpen: () => boolean` callback parameter (simplest, keeps board.ts decoupled from the specific dialog modules) or (ii) have `attachKeyboardNavigation` itself be called from **main.ts** instead of from inside `newBoard()`, after all the dialogs exist, passing `board.state`/`board.htmlBoard`/`board.game` out of the already-returned `Board`. **Prefer (ii)** — it avoids growing `newBoard()`'s parameter list for a concern (dialog coexistence) that `newBoard()` itself has no other reason to know about, and matches how `attachRangeGestures` is *already* called from inside `newBoard()` only because it needs nothing external — the keyboard version does need something external (dialog state), so it belongs where that state already lives: main.ts.
  - So: `attachKeyboardNavigation` is exported from board.ts but **called from main.ts**, not from `newBoard()`. Update this file's own module doc comment accordingly if one exists at the top (it doesn't currently — no change needed there).

- **`src/cell/cell.ts`**
  - Add `toggle: () => void` and `commit: () => void` to the `Cell` interface, implemented by lifting the existing private `toggleMark`/`commitGuess` closures into the returned object literal (or having the object literal's methods delegate to them) with an added frozen guard on each (decision 5). `handleClick`'s existing body is refactored to call `cell.toggle()`/`cell.commitGuess()` — i.e. **not duplicated**, the click handler becomes a thin caller of the same public methods the keyboard path uses, so there is exactly one implementation of each behavior. (`handleClick`'s own top-level `if (cell.frozen) return;` can stay as-is or be removed now that `toggle`/`commit` each guard themselves — removing it is slightly cleaner but not required; note the redundancy explicitly in the diff so a reviewer doesn't wonder if it's a bug.)

- **`src/cell/cell.module.css`**
  - Add a `.cursor` class for the keyboard-focused cell: an outline/ring
    distinct from `.found`/`.error`'s treatments (those recolor the glyph;
    this needs to be visible on an *empty* unmarked cell too, so it can't
    reuse `color`/`text-shadow`). Concretely, an inset `box-shadow` layer
    added *on top of* the existing edge box-shadow list (the `.cell` rule
    already composites four inset shadows for its edge system — `.cursor`
    adds one more to that same `box-shadow` property, all layered, since
    `box-shadow` accepts a comma list and cells already build one
    dynamically) using a new custom property, e.g. `--color-cursor`, defined
    in `style.css` (see next bullet) — a ring inset by a couple pixels so it
    reads distinctly from the region-boundary edge lines already occupying
    the outermost pixels of each cell.
  - Add `--color-cursor` for both light and dark schemes, adjacent to where
    `--color-mark`/`--color-queen`/`--color-error` are already defined in
    `src/style.css` (lines ~143-145 light, ~198-200 dark) — a color that
    reads clearly against every `--color-group-N` background, same
    "must-contrast-with-anything" constraint that already led `.found`/
    `.error` to use a `text-shadow` outline trick rather than relying on a
    single color's own contrast; for a box-shadow ring, a consistent
    high-contrast neutral (e.g. a value close to `--color-region-edge`'s
    `--color-on-surface`, but distinct enough from the region-boundary
    lines' own color to not be confused with them) is simplest — exact
    value picked during implementation with a real screenshot check, same
    as `--region-edge-width`'s own doc comment describes doing.

- **`src/help/help.ts`** (new) + **`src/help/help.module.css`** (new) — the
  `?`-triggered overlay (decision 6), following `options.ts`'s `<dialog>`
  drawer construction pattern closely enough to reuse its CSS shape
  (backdrop, centered card) rather than inventing new dialog chrome; a new
  small `.module.css` is still warranted (not reusing `options.module.css`
  directly) since this codebase's convention is one CSS module per
  component folder (see `gameover/`, `options/`, `startover/` all following
  this).

- **`src/main.ts`**
  - Construct `helpOverlay = newHelpOverlay()` alongside the existing
    `options`/`gameOver` construction; `app.append(helpOverlay.html)`.
  - Build `isAnyDialogOpen = () => options.html.open || gameOver.html.open || helpOverlay.html.open`
    once, after all three exist (i.e. inside `main()`, after `gameOver` is
    constructed) — passed into `attachKeyboardNavigation`.
  - Call `attachKeyboardNavigation(board.htmlBoard, board.state, board.game, isAnyDialogOpen)`
    right after the board is mounted (near where `attachRangeGestures` would
    conceptually sit if main.ts touched it directly — it doesn't today,
    `newBoard()` calls it internally; this new call is the one exception,
    for the reasons in the board.ts bullet above). Its disposer isn't
    currently called anywhere by `newBoard()`-adjacent code for
    `attachRangeGestures` either (single page-load lifetime, per that
    function's own doc comment) — same reasoning applies here: main.ts does
    **not** need to call the returned disposer in production code, only
    tests do (see Test impact).
  - `?`'s dedicated open action: wired inside `attachKeyboardNavigation`
    itself via a callback, e.g. `attachKeyboardNavigation(..., { onHelp: () => helpOverlay.open() })`,
    rather than board.ts importing `help.ts` directly — keeps board.ts from
    needing to know the help overlay exists at all (same decoupling
    principle as passing `isAnyDialogOpen` in rather than board.ts importing
    `options.ts`/`gameover.ts`).

## Test impact

- **`src/cell/cell.test.ts`**: extend with a `describe("toggle/commit
  (public wrappers used by X/Q keyboard handling)")` block mirroring the
  existing `describe("mark ...")` block's shape — assert `toggle()` flips
  0<->1 without touching found/error styling and respects the frozen guard;
  assert `commit()` produces the exact same found/error/frozen outcome as
  the existing two-click `commitGuess()` tests already assert, including
  the same `vi.advanceTimersByTime(0)` + `incFound`/`incGuess` spy pattern
  (reuse the existing `clickAt`-adjacent fake-timer `beforeEach`/`afterEach`
  setup in that file). Also add one regression test that `handleClick`'s
  existing double-click behavior is unchanged after the refactor (the
  existing click-handling `describe` block already covers this — should
  need no edits at all if the refactor is a pure delegation, which is the
  point of doing it that way).

- **`src/board/board.test.ts`**: extend with a new `describe("attachKeyboardNavigation")`
  block using a `buildGrid`-like helper (reuse the existing `buildGrid` /
  add a keyboard-flavored sibling that also calls
  `attachKeyboardNavigation` and pushes its disposer onto the same
  `disposers` array the file's `afterEach` already drains — same
  window-listener-leak concern applies here since this is also a
  `document`-level listener a long-lived jsdom `window` won't clean up
  between tests). Cases to cover:
  - `directionFor`: pure-function table test for every key in every
    direction (arrows, WASD upper/lower, hjkl upper/lower), plus
    unrecognized keys return `null`.
  - Plain arrow/WASD/hjkl `keydown` moves the focus visual (`.cursor`
    class, or the `aria-current` attribute — whichever is cheaper to
    assert in jsdom) from one cell to the expected neighbor; clamped at
    every edge (four separate edge cases, one per direction, matching the
    existing file's granular-per-case style).
  - X toggles the cursor cell only (assert sibling cells untouched).
  - Q on a queen cell commits found; Q on a non-queen cell commits error
    (mirroring cell.test.ts's own two commit-path tests, but driven via a
    simulated `keydown` at the board level instead of a direct `cell.commit()`
    call, to prove the wiring, not just the underlying method).
  - Q on an already-frozen cell is a no-op (state/frozen unchanged).
  - Shift+direction: starting mid-grid, extends a range in the pressed
    direction, marks the whole run to the opposite of the start cell's
    value (mirroring the existing shift+click test's assertions almost
    exactly, via the `states()` helper already in this file); a second
    shift+direction *continuing the same direction* extends the range
    further; a shift+direction that *reverses* direction shrinks the range
    back down, unmarking the cells that fall out of it (the one behavior
    with no mouse-gesture equivalent to mirror — needs its own dedicated
    test since it's the one place this plan's design deliberately diverges
    from the click gesture's mechanics).
  - Releasing Shift (or moving without it) ends the selection — a
    subsequent plain (non-shift) move does not extend/shrink any range.
  - The whole listener is inert (`game.state !== 0` — construct a
    `buildGrid`-equivalent where the passed-in `game.state` is pre-set to
    1 or 2, or actually drive a commit that ends the game via the existing
    guess-budget mechanics) — no key visibly changes anything.
  - The whole listener is inert when `isAnyDialogOpen` returns `true` (pass
    a stub that toggles a boolean) — including `?` remaining unaffected by
    this rule vs. not (per decision 6/2 — assert `onHelp` is *not* called
    while a dialog is open).
  - `?` calls the provided `onHelp` callback exactly once per press when no
    dialog is open and the game hasn't ended.
  - A focused `<input>` (simulate via a real `<input>` appended to the
    document and `.focus()`ed) suppresses all bindings — the
    `activeElement` guard from decision 2.

- **`src/help/help.test.ts`** (new): construction renders the bindings list
  with recognizable text content for each key; `open()`/`close()` toggle
  `html.open`; Escape and a backdrop click both close it (mirror
  `options.test.ts`'s existing dismissable-drawer tests if that file has
  them — check its actual test file for the exact assertion pattern used
  there before writing these, since it's the closest existing precedent for
  this exact dialog shape).

- **`src/main.ts`** currently has no dedicated test file (none was found
  during research) — no new main.ts-level test is planned; its wiring is
  exercised indirectly by the board.test.ts/cell.test.ts/help.test.ts unit
  coverage above plus the manual verification pass below.

## Verification

- `npx tsc --noEmit` clean.
- `npm test` (builds wasm, runs vitest) — all existing tests still green,
  plus every new test listed above.
- Manual keyboard-driven play-through in `npm run dev`: load a small (e.g.
  6x6) board, play an entire game to a win using *only* the keyboard —
  arrows to move, hjkl to move (confirm interchangeable), X to eliminate
  cells, Shift+arrow to range-mark a row and a column (confirm both extend
  and shrink correctly by reversing direction mid-hold), Q to place a
  queen, `?` to open the help overlay mid-game and confirm it lists every
  binding and dismisses via both Escape and a backdrop click without
  affecting the board underneath, confirm the timer keeps running while it
  is open. Confirm the options drawer's size input still accepts normal
  typed digits (arrow keys inside it don't move the board cursor). Confirm
  a loss (exhaust guesses via Q on wrong cells) correctly freezes keyboard
  input except `?`. Confirm Tab and Ctrl+F (browser find) are both
  unaffected throughout.

## Process

Implementation is delegated to a single Haiku subagent working from this
plan file as its spec, running in auto-mode permissions (no interactive
approval per file edit). Once it reports done, independently re-verify
before considering this landed: read the actual diff (not just the
subagent's summary), run `npx tsc --noEmit`, run `npx vitest run`, and do
the manual keyboard play-through described above in the dev server — this
matches how every other plan in this repo's `docs/plans/` gets implemented
once approved.

**This plan is saved for later — not implemented yet.** Nothing in this
document has been coded; it is pending the user's separate go-ahead to
begin implementation.
