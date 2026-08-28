# Streamline win/loss modal layout

## Context

Win modal (`src/gameover/gameover.ts`) grew cluttered as fields got added
this session (score, then weekly score). It's currently a tall stack of
left-aligned lines (heading / message / score / weekly score / right-aligned
button row / full "Share" button), which reads as busy and takes up more
vertical space than it needs to. User wants:

1. Score + solve time on one line, not two.
2. Header, message/score line, and the action-button row centered instead
   of left/right aligned.
3. Share button: drop the "Share" label, icon-only, moved to sit inline with
   the score/time line instead of living in the bottom button row.

Weekly score line is left as its own (centered) line below — not mentioned
by the user as part of the one-line merge.

## Design

### `src/gameover/gameover.ts`

- New wrapper `summaryRow` (`div`, `classes.summaryRow`) inserted where
  `message` and `score` currently sit back-to-back. Contains, in order:
  `message`, `score`, `shareButton.html`. `weeklyScore` stays a separate
  sibling `<p>` after `summaryRow`, unchanged in role.
- `message.textContent` on win drops its trailing period so it reads as a
  clause, not a full sentence, since `score` now follows it inline:
  `won ? \`Solved in ${formatElapsed(elapsedMs)}\` : "No guesses left — better luck next time."`
  (loss text unchanged, still a full sentence — it's the only thing on that
  line).
- `score` keeps its existing `<p>` tag and `hidden` toggle logic (tests key
  off `querySelectorAll("p")` — see Test impact). Content unchanged
  (`Score: ${scoreValue}`); the "Solved in X · Score: Y" look comes from a
  CSS `::before` dot on `.score`, not from string concatenation, so the
  `hidden` toggle continues to cleanly remove the whole score+dot as one
  unit.
- `shareButton` construction gets `iconOnly: true` added to its config (new
  option — see share.ts below), and moves from being appended to `actions`
  to being appended to `summaryRow` instead, right after `score`. Everything
  else about it (`getUrl`, `text`) is unchanged.
- `actions` div keeps `tryAgain` / `changeOptions` / `newGame` exactly as
  today — just the share button is no longer in it.

### `src/gameover/gameover.module.css`

- `.card`: add `text-align: center;` — centers `heading`, `message`,
  `score`, `weeklyScore` (all inline/block text) for free.
- `.actions`: change `justify-content: flex-end` → `justify-content: center`.
- New `.summaryRow`: `display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.4em; margin: 0 0 0.25em;` — replaces `.message`'s and `.score`'s old bottom margins for this merged line (both existing rules keep their `font-weight`/sizing, just lose their own `margin` since the row now owns spacing — see below).
- `.message`: drop its `margin: 0 0 1.25em` (now a flex child of `.summaryRow`; margin moves to the row).
- `.score`: drop its `margin: 0 0 1.25em`; add
  `&::before { content: "·"; margin-right: 0.4em; opacity: 0.6; }` (plain
  CSS, no nesting-plugin — repo's other files don't nest, so write it as a
  separate `.score::before { ... }` rule) — the dot only ever renders when
  `.score` itself is visible, since `[hidden]` removes the whole element
  including its `::before`.
- `.weeklyScore`: keep as-is (already centered for free via `.card`'s new
  `text-align: center`), just fix its `margin: -1em 0 1.25em` — the `-1em`
  was clawing back `.score`'s old `1.25em` bottom margin, which no longer
  exists once `.score` moves inside `.summaryRow`. Change to
  `margin: 0 0 1.25em;`.

### `src/share/share.ts`

Add an `iconOnly?: boolean` (default `false`) field to `ShareButtonConfig`.
When `true`:

- `labelSpan` is created exactly as today (still needed so `flash()`'s
  "Link copied!" / raw-URL fallback confirmation still has somewhere to
  render), but starts with inline `display: none` instead of showing
  `DEFAULT_LABEL` text.
- `flash(message, ms)` temporarily sets `labelSpan.style.display = ""` for
  the duration of the flash (alongside its existing text swap), then
  restores `display: none` in the same `setTimeout` that resets the text
  back to `DEFAULT_LABEL`. Non-icon-only behavior (`labelSpan` always
  visible) is unchanged.
- `html.setAttribute("aria-label", title)` (reuses the existing `title`
  param, defaulting to `"Colordoku"` today — pass `"Share"` explicitly from
  gameover.ts's call site) so the button still has an accessible name even
  though its icon is `aria-hidden` and its label text is visually hidden by
  default.
- No other behavior changes; default (`iconOnly: false`) path is byte-for-byte
  what exists today, so `main.ts`'s and `historyview.ts`'s existing
  `newShareButton` call sites need no changes.

## Files touched

- `src/gameover/gameover.ts`
- `src/gameover/gameover.module.css`
- `src/gameover/gameover.test.ts`
- `src/share/share.ts`
- `src/share/share.test.ts` (add coverage for `iconOnly`, don't touch existing tests)

## Test impact

- `gameover.test.ts`'s `"shows share button on win but not on loss"` test
  currently locates the button via
  `b.textContent?.includes("Share")` — that will break once the label is
  visually hidden by default. Update the lookup to
  `b.getAttribute("aria-label") === "Share"` instead (aria-label is being
  added specifically to support this).
- Other existing `gameover.test.ts` assertions (`"Score: 1234"`,
  `"This week: 5000"` via `textContent`/`querySelectorAll("p")`) are
  unaffected — same elements, same tag, same hidden-toggle logic, just
  reparented into `summaryRow`.
- `share.test.ts`: existing tests all use the default (`iconOnly` omitted)
  config and assert `html.textContent === "Share"` etc. — must keep passing
  unchanged. Add one new test: `iconOnly: true` renders with empty visible
  label (labelSpan `display: none`) but `aria-label="Share"` present, and a
  flash (e.g. clipboard-fallback copy path) still surfaces its confirmation
  text via the same `textContent` assertion pattern as the existing flash
  tests (temporarily un-hidden).

## Process

Single Haiku subagent, auto-mode permissions, this plan file as spec — same
pattern as every other implementation round this session. I'll independently
re-verify after: read the diff, `npx tsc --noEmit`, `npx vitest run`, plus a
manual look at the modal in the dev server (both win and loss states) since
this is a visual/layout change that tests can't fully cover.

**Not implementing yet** — this plan is saved for later per this session's
"defer until asked" convention; already living at its permanent location
(`~/.claude/plans/dynamic-noodling-sutton.md` today, to be copied to
`docs/plans/gameover-modal-layout.md` per CLAUDE.md's "save deferred plans to
docs/plans/" rule) rather than only the CLI's single-slot plan file.

## Verification (once implementation is greenlit)

- `npx tsc --noEmit` clean.
- `npx vitest run` — all passing, including the updated/new tests above.
- Manual: trigger a win and a loss in the dev server; confirm centered
  layout, "Solved in X · Score: Y" reads as one line, share icon sits next
  to it (win only), weekly-score line below, button row centered underneath.
