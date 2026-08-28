# Fix native scroll hijacking the mobile touch-drag marking gesture

## Context

On touchscreen devices, dragging a finger across the board to multi-mark
cells (`attachRangeGestures`'s touch-drag path in `src/board/board.ts`)
frequently loses the gesture to native page scroll instead — even though
`html { overflow-y: hidden; }` already exists in `src/style.css`
specifically to try to prevent this.

A prior read-only investigation identified six contributing causes, ranked
by confidence. This plan verifies each against the actual current code and
designs a concrete fix for all six. Confirmed while writing this plan
(current line numbers, `src/board/board.ts`):

- The `touchmove` listener (`board.addEventListener("touchmove", ...,
  { passive: false })`, ~line 391) only calls `event.preventDefault()`
  when `touchDrag.move(...)` returns `true` (line 396-400).
- `createDragTracker()`'s `move()` (line 242) only flips `moved` to `true`
  once the touch point has reached a **different** cell than `start`
  (line 245-262) — every touchmove that fires while the finger is still
  over the starting cell returns `false` and skips `preventDefault()`.
  Browsers commit to native scroll based on the earliest unprevented
  cancelable `touchmove`, so by the time `moved` flips, it's typically too
  late.
- `.cell` in `src/cell/cell.module.css` sets `touch-action: manipulation`
  (line ~26), whose comment explains it's there to disable double-tap-zoom.
  Per spec, `manipulation` = `pan-x pan-y manipulation`-minus-double-tap —
  it does **not** disable panning/scrolling, only pinch-zoom and
  double-tap-zoom. Confirmed no `touch-action` exists anywhere on `#board`
  itself in `src/style.css`.
- `html { overflow-y: hidden; }` (`src/style.css`, in the `#board`-adjacent
  block) is confirmed present and is a known-insufficient fix for this
  exact iOS Safari quirk — iOS's touch-driven scroll pipeline runs through
  `touch-action`/`preventDefault()` on the touch stream, largely
  independent of the CSSOM `overflow` property.
- `#board`'s `--board-pad: 0.2rem` (`src/style.css`) creates a small strip
  inside `#board`'s own box that isn't part of any `.cell` — confirmed a
  touch starting there isn't in `coordOf` (board.ts's `hitFor`/`hitAtPoint`
  return `null`), and has no CSS backstop today either.
- No `overscroll-behavior` exists anywhere in `src/style.css`.
- `index.html`'s viewport meta tag has no `maximum-scale`/`user-scalable`.
  Left alone — pinch-zoom, not vertical-scroll-during-drag, is a different
  concern and out of scope here.

Also confirmed while reading `src/options/options.module.css`,
`src/historyview/historyview.module.css`, and
`src/scoreview/scoreview.module.css`: all three drawers/dialogs are
genuinely scrollable (`max-height: 90dvh; overflow: auto;`) — this matters
for scoping the CSS fixes below, since a blanket `touch-action: none` or
overly aggressive `overscroll-behavior` on `html`/`body` risks breaking
scrolling inside them.

## Design

### 1. `preventDefault()` timing — `src/board/board.ts`

Root cause: scroll-prevention is currently gated on `touchDrag.move()`'s
`moved` flag, which only becomes true after the touch has crossed into a
different cell. Fix: decouple "should this touchmove suppress native
scroll" from "has a drag actually started moving cell-to-cell" — the
former should be decided once, at `touchstart`, based purely on whether the
touch began on a real cell; the latter keeps its existing job of deciding
what to mark.

Add one new piece of state alongside `touchDrag` (~line 373):

```ts
const touchDrag = createDragTracker();
let touchStartedOnCell = false;
```

Rewrite the `touchstart` handler (~line 375-389) to compute the hit once
and use it both to seed `touchDrag` and to set the new flag:

```ts
board.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    if (touch === undefined) return;
    const hit = hitAtPoint(touch.clientX, touch.clientY);
    // Scroll-suppression only cares whether the touch landed on a real
    // cell at all (frozen or not) — unlike touchDrag.begin()'s target,
    // which additionally refuses a frozen cell. A drag that starts on a
    // frozen cell is inert for marking (see createDragTracker's frozen
    // handling) but the finger is still physically on the board and
    // should not hand the gesture to the browser's native scroll.
    touchStartedOnCell = hit !== null;
    touchDrag.begin(hit);
  },
  { passive: true },
);
```

(`touchstart` itself stays `{ passive: true }` and never calls
`preventDefault()` — see the note on why below.)

Rewrite the `touchmove` handler (~line 391-403) to preventDefault
unconditionally, for every touchmove event, as soon as the touch is known
to have started on a cell — not gated on `touchDrag.move()`'s return value:

```ts
board.addEventListener(
  "touchmove",
  (event) => {
    const touch = event.touches[0];
    if (touch === undefined) return;
    // Suppress native scroll starting on the very first touchmove of a
    // touch that began on a cell — not deferred until createDragTracker
    // decides a "real drag" has happened (crossed into a different cell).
    // Browsers commit to native scroll based on the earliest unprevented
    // cancelable touchmove; waiting for `moved` to flip is too late.
    if (touchStartedOnCell) event.preventDefault();
    touchDrag.move(hitAtPoint(touch.clientX, touch.clientY));
  },
  { passive: false },
);
```

`touchDrag.move()`'s return value is no longer consumed here (marking
eligibility and scroll-suppression are now separate concerns) — its
signature and internal logic are otherwise unchanged; its doc comment
("Returns true if this move is part of an active drag (so the caller
should treat the event as consumed — e.g. preventDefault)") should be
updated to drop the now-inaccurate preventDefault reference, since that
job moved to the flag above.

Reset the flag alongside the existing `touchend`/`touchcancel` cleanup
(~line 405-415), so a stale `true` from a finished touch can't leak into
whatever touch sequence starts next:

```ts
board.addEventListener("touchend", (event) => {
  if (touchDrag.end()) {
    event.preventDefault();
  }
  touchStartedOnCell = false;
});

board.addEventListener("touchcancel", () => {
  touchDrag.end();
  touchStartedOnCell = false;
});
```

**Why not `preventDefault()` in `touchstart` instead/also**: investigated
and rejected. Calling `preventDefault()` on `touchstart` has historically
suppressed the browser's synthesized trailing `click` event on some
WebKit versions (unlike `touchmove`/`touchend`, where the existing code
already relies on `preventDefault()` *not* blocking `click` in the no-drag
case — see the `touchend` handler's own comment about the tap-synthesized
click). Requirement (b) — a plain tap must still reach `cell.ts`'s
click-driven single/double-click handling — depends on that synthesized
click firing normally for a tap that never drags. Since a plain tap
produces zero (or effectively-stationary, sub-cell-boundary) `touchmove`
events, leaving `touchstart` alone and doing the suppression in
`touchmove` costs nothing for the tap case: `touchmove`'s
`preventDefault()` only ever blocks scrolling, never the `click` event
that follows `touchend`.

**Why this satisfies both non-regression requirements**:
- (a) A touch starting outside any cell (e.g. the `--board-pad` gutter,
  handled separately in section 4 below) gets `touchStartedOnCell =
  false`, so its `touchmove` events never call `preventDefault()` —
  native scroll is left alone there, exactly as before.
- (b) A plain tap dispatches no meaningful `touchmove` before `touchend`,
  so this change doesn't touch the tap-to-click path at all; the existing
  `touchend`/click-suppression logic (only swallow the synthesized click
  when `touchDrag.end()` reports a real drag happened) is untouched.

### 2. `touch-action` — `src/cell/cell.module.css` and `src/style.css`

`.cell`'s current `touch-action: manipulation` (`src/cell/cell.module.css`,
in the block with the double-tap-zoom comment) only disables
double-tap/pinch-zoom, not panning. Per the Touch Action spec, `none`
disables *all* browser-handled panning and zooming, including double-tap
zoom — so switching to `none` is strictly broader and still satisfies the
original double-tap-zoom rationale documented there; it does not need a
separate `manipulation` rule anywhere once `none` is in place.

Change `.cell`:

```css
.cell {
  /* Disables all browser-handled touch gestures (panning *and*
   * zooming) on a cell, not just double-tap-zoom (see the comment this
   * replaces below for the original narrower reasoning) — a plain
   * `manipulation` still permits native pan/scroll, which is exactly
   * what let touch-drag marking lose the gesture to page scroll; `none`
   * is a superset that also keeps double-tap-zoom disabled. Combined
   * with board.ts's touchmove preventDefault() (belt-and-suspenders: the
   * compositor consults touch-action before any JS runs, independent of
   * preventDefault) and #board's own touch-action: none below.
   */
  touch-action: none;
  ...
}
```

Also add `touch-action: none` on `#board` itself in `src/style.css`
(inside the existing `#board { ... }` rule), so the board container as a
whole — not just its `.cell` children — is covered. This also directly
addresses the padding-gutter case in section 4 below: `--board-pad`'s
strip is part of `#board`'s own box, not a `.cell`, so it only gets
`touch-action: none` coverage from a rule on `#board` itself, not from
`.cell`'s rule. (Per the touch-action spec, the effective restriction for
a touch is the intersection of the target element's own value and every
ancestor's value up to the nearest scrolling ancestor — setting it on
both `#board` and `.cell` is not redundant, it's what makes the gutter
case and the cell case both covered without relying on inheritance, since
`touch-action` is not an inherited CSS property.)

### 3. `overflow-y: hidden` — scope decision

Keep `html { overflow-y: hidden; }` in `src/style.css` — it's still doing
useful work on non-iOS browsers (reliably blocks wheel/programmatic
scroll there) and removing it buys nothing. It just isn't sufficient
alone on iOS, which is what sections 1 and 2 above are for.

Do **not** widen it into a broader `touch-action: none` on `html`/`body`.
Confirmed via `src/options/options.module.css`, `historyview.module.css`,
and `scoreview.module.css`: all three drawers (`options.ts`'s new-game
sheet, `historyview.ts`, `scoreview.ts`) are `<dialog>`s with
`max-height: 90dvh; overflow: auto;` — genuinely scrollable content that
can exceed the viewport (e.g. a long history list). A page-wide
`touch-action: none` on `html`/`body` would disable touch scrolling
inside those dialogs too, since `<dialog>` content isn't a separate
touch-action scope by default. Scoping the `touch-action: none` fix to
`#board`/`.cell` only (section 2) avoids this entirely — the drawers are
never inside `#board`, so they're unaffected.

### 4. `#board`'s padding gutter

Handled by section 2's `#board { touch-action: none; }` addition — no
separate fix needed. Confirmed no redundancy concern: `.cell`'s own
`touch-action: none` handles touches that land on a cell, and `#board`'s
covers the gutter strip (and, per the touch-action ancestor-intersection
rule noted above, doesn't conflict with `.cell`'s value where they
overlap).

### 5. `overscroll-behavior` — `src/style.css`

Add to the existing `html { overflow-y: hidden; }` rule:

```css
html {
  overflow-y: hidden;
  overscroll-behavior: none;
}
```

Scope: `html` (not also `body` — `body` has no scroll mechanics of its
own here; `min-height: 100dvh` on `body` in this file doesn't make it a
separate scroll container). Value: `none` rather than `contain` — this
app has no legitimate case where scroll should ever propagate to a parent
element/the browser chrome from the page's own root (there is no "outer"
scrollable ancestor to intentionally allow chaining into), and `none` is
the stronger guarantee against the leftover overscroll glow/rubber-band
bounce this item exists to prevent. This is a `html`-level setting only
and does not reach inside the drawers' own `overflow: auto` scroll
containers — each `<dialog>` is its own independent scrolling box, so its
internal overscroll behavior (bounce at the top/bottom of a long history
list, say) is untouched by this change, which is the desired scope: this
plan isn't trying to change drawer-scrolling feel, only the board's.

### 6. Viewport meta tag — `index.html`

No change. Confirmed low-relevance per the original investigation: this
bug is about touchmove-driven vertical pan being captured by native
scroll, not pinch-zoom. `maximum-scale`/`user-scalable=no` affects only
pinch/double-tap zoom bounds, which sections 2's `touch-action: none`
already fully covers for the board specifically (and section 6 is
intentionally not chasing a global zoom-disable that would affect the
whole page, including the drawers, for a concern this bug isn't about).

## Files touched

- `src/board/board.ts` — `touchstart`/`touchmove`/`touchend`/`touchcancel`
  listeners inside `attachRangeGestures` (new `touchStartedOnCell` flag,
  moved `preventDefault()` call, updated `move()` doc comment).
- `src/cell/cell.module.css` — `.cell`'s `touch-action` value and its
  comment.
- `src/style.css` — `#board`'s new `touch-action: none`; `html`'s new
  `overscroll-behavior: none`.
- `src/board/board.test.ts` — new/updated test cases, see below.

## Test impact

`src/board/board.test.ts`'s `"attachRangeGestures: touch-drag marking"`
describe block (~line 206 onward) already has a `touchEvent()` helper that
builds `cancelable: true` synthetic events and asserts `.defaultPrevented`
(used today by the "plain tap" and "prevents the tap-synthesized click"
tests). That harness covers the JS state-machine half of this fix
directly; CSS-only changes (`touch-action`, `overscroll-behavior`) have
**no meaningful automated coverage in this codebase's existing setup** —
`touch-action` is a compositor-thread hit-testing concern jsdom/happy-dom
doesn't implement, and there is no way to assert it did anything from a
unit test. The plan does not invent fake coverage for those; they're
verified only by real-device/emulated-touch checks (see Verification).

New/updated test cases for the `touchmove` `preventDefault()` change:

1. **New**: a touch that starts on a real (unfrozen) cell has
   `preventDefault()` called on its very first `touchmove` — even while
   still over the starting cell (before any cell-to-cell movement, i.e.
   before `moved` would have flipped under the old logic). This is the
   core regression test for the fix: dispatch `touchstart` at a placed
   cell's point, then a `touchmove` at that *same* point, and assert the
   move event's `.defaultPrevented === true`.
2. **New**: a touch that starts *outside* any cell (a point with nothing
   placed via `place()`, so `hitAtPoint` resolves to `null`) does **not**
   get `preventDefault()` called on its `touchmove` — dispatch
   `touchstart` at an unplaced point, then `touchmove`, assert
   `.defaultPrevented === false`. Covers requirement (a).
3. **Existing, unaffected**: `"marks every cell the finger passes over..."`,
   `"a plain tap...marks nothing"`, `"prevents the tap-synthesized
   click..."`, `"skips a frozen cell mid-drag"`, `"a drag starting on a
   frozen cell is inert"`, `"touchcancel ends the drag"` — all still pass
   unchanged; none of them assert on `touchmove`'s `defaultPrevented`
   value in the "not yet moved" state, so none conflict with test 1 above.
   Worth a read-through after implementing to confirm none accidentally
   relied on the old gated-on-`moved` timing.
4. Consider whether a frozen-start-cell touch should also get `touchmove`
   `preventDefault()` (per this plan's `touchStartedOnCell` design, yes —
   it's set from `hit !== null`, before `touchDrag.begin()`'s separate
   frozen check). If landed, add a short test asserting that too, for
   completeness with the "drag starting on a frozen cell is inert" test's
   existing setup.

## Verification

Once implemented:

- `npx tsc --noEmit` clean.
- `npx vitest run` — all existing tests plus the new ones above passing.
- **Real-device or browser touch-emulation check is required and is the
  part that actually matters for this bug** — jsdom/happy-dom (unit
  tests) and a desktop browser's mouse emulation of a touchscreen cannot
  reproduce the browser's native scroll-commit heuristic or `touch-action`
  compositor behavior. Verify on either a real touchscreen device, or a
  desktop browser's device-emulation *touch* simulation (e.g. Chrome
  DevTools' device toolbar with touch events enabled, not just a resized
  viewport) — drag across several cells and confirm the page never
  scrolls, while a plain single tap and the existing double-tap-to-commit
  gesture still both work.
- `touch-action`/`overscroll-behavior` CSS correctness cannot be unit
  tested at all in this codebase's current setup — confirm by eye only,
  per the point above.

## Process

This plan is saved for later, not implemented yet — pending the user's
separate go-ahead, per this repo's usual `docs/plans/` convention.

Once approved: implemented by a Haiku subagent using this plan file as
spec, followed by independent re-verification — read the resulting diff,
then run `npx tsc --noEmit` and `npx vitest run` myself. Given this is a
touch/mobile CSS+JS interaction bug that cannot be verified in
jsdom/happy-dom or via a desktop browser's mouse emulation alone, real
verification additionally requires either a real touchscreen device or a
browser's device-emulation *touch* simulation, and CSS-only
`touch-action`/`overscroll-behavior` correctness specifically cannot be
meaningfully unit-tested at all — only the JS state-machine logic
(`createDragTracker`, the `touchStartedOnCell` gating) can be, via the
test cases listed above.
