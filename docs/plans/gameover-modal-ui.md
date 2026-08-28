# #gameover-ui: win/loss modal improvements

Scope: the four README subtasks under "UI indicating a game was won or lost"
that don't depend on the leaderboard existing (it doesn't yet — see
`docs/research/leaderboard-crdts.md`, still at the research stage). The two
leaderboard-dependent subtasks (ranking-change display, first-win
opt-in-introduction modal) are explicitly **out of scope** here — do not
implement them, and do not add leaderboard plumbing to reach them.

In scope:
1. Confetti animation on a win.
2. Score shown in the win modal.
3. A way to share the board + completion time/score from the win modal.
4. A "try again" option on a loss (replay the *same* board, not a new one).

## Files involved

- `src/gameover/gameover.ts` — the modal itself; most of the work.
- `src/gameover/gameover.module.css` — new styles (confetti pieces, score
  line, share/try-again buttons).
- `src/gameover/gameover.test.ts` — extend for every behavior below.
- `src/main.ts` — wiring: pass score, a same-seed retry callback, and a
  share URL/text into `newGameOver`'s config and `show()` call.

## 1. Score in the win modal

- `GameOverResult` (gameover.ts) gains `score: number`.
- `GameOverConfig`/`show()` need no other change — score is only meaningful
  once a game has ended, same lifecycle as `elapsedMs` today.
- In `show()`, when `state === 1` (won), render a new line below `message`:
  e.g. `Score: 1234` (reuse `message`'s styling pattern — a `<p>` with its own
  class in `gameover.module.css`, e.g. `.score`). Do **not** render this line
  on a loss — `persistence/score.ts`'s `computeScore` always returns 0 for a
  loss, so showing "Score: 0" adds nothing (see that file's doc comment for
  why losses always score 0 — a deliberate product decision, not a bug to
  route around here).
- `main.ts`: it already calls `computeScore(board.game.size, difficulty,
  timer.elapsedMs(), status)` inside `persist()`. `board.game.onEnd` needs
  that same score value to pass into `gameOver.show({ state, elapsedMs,
  score })` — compute it once at the top of the `onEnd` callback (map `state`
  1/2 to `computeScore`'s `"won"/"lost"` the same way `statusFromGameState`
  already does elsewhere in this file) rather than duplicating persist()'s
  own computation inline; look at how `persist()` derives `status` from
  `board.game.state` and mirror that, don't refactor `persist()` itself.
  The resumed-already-ended-game branch (`if (saved !== null && saved.gameState
  !== 0)`) needs a score too — `saved` doesn't carry one today, so compute it
  the same way from `saved.gameState`/`saved.elapsedMs`/`difficulty`/`size`.

## 2. Confetti on a win

- Pure CSS + a handful of DOM nodes, no canvas and no dependency — this
  codebase has none and shouldn't gain one for this.
- In `gameover.ts`, add a `confetti` container `<div>` (e.g.
  `classes.confetti`) appended to `html` (the `<dialog>`) *before* the
  heading, so it paints behind the modal's content but is still inside the
  dialog's own stacking context (the modal already has a backdrop; confetti
  falling "behind the modal in the background" per the README wording means
  behind the modal's own content box, within the dialog, not behind the
  backdrop).
- On `show()` with `state === 1`: clear any confetti pieces left from a
  previous `show()` call, then create ~24-40 small `<span>`s
  (`classes.confettiPiece`), each with inline custom properties picked
  per-piece so CSS can vary them: a random horizontal start position packed
  toward the left/right edges (not the center — "popping in from the sides"),
  a random launch angle around 45°, a random fall duration/delay, and a
  random color pulled from the same `--color-group-N` custom properties
  `style.css` already defines for board regions (reuse the existing palette,
  don't invent a new one). A CSS `@keyframes` animation moves each piece from
  its start position up-and-out along the angle, then arcs down past the
  bottom of the modal; `animation-fill-mode: forwards` plus removing the
  pieces after their animation ends (an `animationend` listener, or a
  `setTimeout` matched to the longest duration used) keeps the DOM clean
  between game-overs.
- On `state === 2` (loss), do not add confetti; if a piece from a previous
  win is still mid-animation when a new `show()` fires (shouldn't happen in
  practice since a modal reload always follows a fresh board, but be
  defensive), the clear-before-repopulate step above already handles it.
- Respect `prefers-reduced-motion`: wrap the animation in
  `@media (prefers-reduced-motion: no-preference)` in the CSS so a user with
  that OS setting gets the modal with no motion at all, not a broken partial
  animation.

## 3. Share board + time/score from the win modal

- Reuse `src/share/share.ts`'s existing `newShareButton`/`buildShareUrl` —
  do not write a new share mechanism. The board view above the board already
  has one (`main.ts`'s `share` const); this is a second instance scoped to
  the modal, with different `text`.
- `GameOverConfig` gains `getShareUrl: () => string` (same signature/shape as
  `ShareButtonConfig.getUrl` in share.ts — pass `main.ts`'s existing
  `buildShareUrl(size, board.seed, location.origin, location.pathname)`
  closure straight through, don't rebuild it).
- In `gameover.ts`, construct one `newShareButton` at module-build time
  (inside `newGameOver`, alongside the existing `changeOptions`/`newGame`
  buttons), with `text` built inside `show()` from the actual result — e.g.
  `` `I solved a ${size}x${size} Colordoku in ${formatElapsed(elapsedMs)} — score ${score}!` `` —
  which means the share button's `text` can't be fixed at construction time
  the way `getUrl` can. `newShareButton`'s `text` option has no setter, so
  either (a) construct a fresh `newShareButton` inside `show()` each time
  (cheap — it's a handful of DOM nodes, no listeners left dangling since the
  old button element is simply not re-appended), replacing whatever share
  button is currently in `actions`, or (b) extend `share.ts` to accept
  `getText: () => string` alongside `getUrl` the same lazy way. Prefer (b) —
  it matches `getUrl`'s existing "called fresh on every click" pattern
  instead of rebuilding a DOM node on every `show()` — but only gameover.ts
  needs it, so keep `text?: string` as a plain string default for
  `main.ts`'s existing above-the-board share button and add `getText` as a
  separate optional override that takes precedence when both would apply, OR
  simpler still: allow `text` to be either a string or a `() => string`, and
  the one line in `share()`'s handler that reads `text` resolves it either
  way. Pick whichever keeps `share.ts`'s existing callers (`main.ts`) working
  unmodified; do not change `main.ts`'s existing share button call site.
- Only shown on a win — `state === 1` — same as score and confetti; a loss
  gets no share option in the modal (the board-view share button above the
  board is unaffected either way and keeps working for both outcomes, since
  it isn't wrapped in a win check).

## 4. "Try again" on a loss

- `GameOverConfig` gains `onTryAgain: () => void`.
- `main.ts` passes `() => startOver(size, board.seed, difficulty)` — the
  exact same call `newStartOverButton`'s `onConfirm` already uses elsewhere
  in this file (search for `startOverBtn` in main.ts) — same board, same
  difficulty, fresh attempt. Reuse `options.ts`'s exported `startOver`
  function; don't reimplement its abandon-then-navigate sequence here.
- In `gameover.ts`, add a "Try again" button to `actions`, shown only when
  `state === 2` (lost) — a win already offers "New game, same size" (which
  starts a *different* board at the same size) and doesn't need a same-board
  retry option; the README task specifically scopes this to a loss. Wire its
  click handler the same way `newGame`/`changeOptions` do: close the dialog,
  then call `onTryAgain()`.
- Button order/placement: put "Try again" first (leftmost, since `actions`
  is `justify-content: flex-end` — leftmost in DOM order is visually
  leftmost among the group), ahead of "Change size…" and "New game, same
  size", so the most likely action after a loss (immediately retry) doesn't
  make the player hunt for it among the other two.

## Show()/actions visibility, overall

`show()` needs to toggle button/element visibility by outcome, not just
text — same pattern already used for `.won`/`.lost` heading color via
`classList.toggle`. Concretely, per state:

| Element | Won | Lost |
|---|---|---|
| score line | shown | hidden |
| confetti | plays | none |
| share button | shown | hidden |
| "Try again" | hidden | shown |
| "Change size…" | shown | shown |
| "New game, same size" | shown | shown |

Use `hidden` (the existing pattern elsewhere in this codebase, e.g.
`startover.ts`'s `startOverBtn.hidden`) rather than removing/re-adding
elements from the DOM.

## Tests (`gameover.test.ts`)

Extend the existing `mount()` helper's config to include `onTryAgain` (a
`vi.fn()`) and `getShareUrl` (returning a fixed test URL), and every
`show()` call in existing tests to include a `score`. Add:

- Win shows the score line with the right number; loss does not show a score
  line at all (`textContent` assertion, or query the score element and
  assert it's absent/hidden).
- Win shows a share button (query by the same icon/label pattern
  `share.test.ts` or `main.ts` already uses for the existing one); loss does
  not.
- Loss shows "Try again"; clicking it closes the modal and calls
  `onTryAgain` once — same assertion shape as the existing "new game, same
  size" test. Win does not show "Try again".
- Confetti: on a win, the confetti container has at least one child element
  after `show()`; on a loss, it has none. Don't assert exact animation CSS
  values — that's implementation detail, not behavior worth pinning in a
  test.
- `prefers-reduced-motion` is a CSS media query, not testable in jsdom/
  happy-dom in this suite's existing style — skip trying to assert it in
  tests; the CSS rule itself is the implementation.

## Verification

- `npm test` (builds wasm, runs vitest) — all existing + new gameover tests
  green, no regressions elsewhere (share.test.ts, main.ts-level tests if
  any).
- `npx tsc --noEmit` clean.
- Manually check in a browser (`npm run dev`, play a 4x4 or similar quick
  board to both a win and a loss): confetti actually renders and clears
  itself, score shows on win only, share button on win only, "Try again" on
  loss only actually restarts the same board (same regions/queen layout —
  compare visually or check the URL's `board-id` is unchanged after clicking
  it), and `prefers-reduced-motion` (toggle it in devtools' rendering panel)
  suppresses the confetti animation.
