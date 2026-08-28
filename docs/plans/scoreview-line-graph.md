# Score-over-time: add a line graph

## Context

`src/scoreview/scoreview.ts` (just built this session) currently shows
weekly score totals as a plain text list (`groupByWeek` buckets, newest
first: date range + total + games won). User wants the trend shown as a
graph — "likely a line graph" — rather than (or in addition to) reading raw
numbers down a list.

No charting library exists anywhere in this codebase, and CLAUDE.md's whole
stack is vanilla TS/hand-built DOM with zero runtime dependencies beyond
Vite — adding a charting package would be the first dependency of its kind
in the project. A small hand-rolled inline SVG line chart matches the
existing "no icon font/library, plain inline `<svg>`" pattern already used
in `share.ts`/`usermenu.ts` for icons, so that's the approach here, not a
new package.

## Design

**Keep the existing list** — the chart is additive (at-a-glance trend),
the list stays (exact numbers per week), same relationship a chart+table
pairing usually has. Insert the new `<svg>` between the existing `.summary`
line and the `.list`.

### Data prep

`groupByWeek(all)` returns buckets **newest-first**; the chart needs
chronological (oldest→newest, left-to-right) order:
```ts
const chronological = [...buckets].reverse();
```

### SVG construction (in `render()`, alongside the existing list-building code)

Fixed logical coordinate space, scaled fluidly via `viewBox`:
```ts
const CHART_W = 600;
const CHART_H = 200;
const PAD_X = 30;
const PAD_Y = 20;
```

- `n = chronological.length`. If `n === 0`: no chart (empty state already
  handles this — hide the chart element same as the list).
- `maxTotal = Math.max(1, ...chronological.map(b => b.total))` (the `1`
  floor avoids division by zero when every week's total is 0 — a real
  possible case, e.g. all losses/abandons).
- `xFor(i) = n === 1 ? CHART_W / 2 : PAD_X + i * (CHART_W - 2 * PAD_X) / (n - 1)`.
- `yFor(total) = PAD_Y + (CHART_H - 2 * PAD_Y) * (1 - total / maxTotal)`
  (all totals are ≥ 0 — scores never go negative — so the baseline is
  always 0, no separate min-scaling needed).
- Build `points = chronological.map((b, i) => ({ x: xFor(i), y: yFor(b.total), bucket: b }))`.

### Elements (all via `document.createElementNS("http://www.w3.org/2000/svg", tag)`
— **not** `document.createElement`, SVG needs its own namespace or nothing
renders; call this out explicitly to the implementing agent, easy mistake)

- `<svg viewBox="0 0 {CHART_W} {CHART_H}" preserveAspectRatio="none" role="img" aria-label="...">` —
  `aria-label` a one-line summary, e.g. `Weekly score trend over {n} weeks, most recent week {lastTotal} points` (the list below already gives full per-week detail for screen readers/sighted users alike — the label just needs to orient, not enumerate every point).
- A baseline `<line>` at `y = CHART_H - PAD_Y` from `x=PAD_X` to `x=CHART_W - PAD_X`, `stroke="var(--color-border)"`.
- If `n >= 2`: a `<polyline points="x1,y1 x2,y2 ...">`, `fill="none"`, `stroke="var(--color-queen)"` (reusing the existing "positive/success" token, same one `cell.module.css`'s `.found` and the win-modal heading already use — keeps the color language consistent rather than inventing a new one), `stroke-width="2"`.
- One `<circle r="4" fill="var(--color-queen)">` per point (also when `n === 1` — single point still renders, just no line to connect it), each containing a child `<title>` (SVG's native tooltip element, no JS/CSS needed) with text `${formatDateRange(bucket.bounds.start, bucket.bounds.end)}: ${bucket.total} points` — reuse the existing `formatDateRange` helper already in this file.
- Wrap the whole thing in a `<div class={classes.chartWrapper}>` (or apply sizing directly to the `<svg>`, agent's call) so CSS can control its box independent of the SVG's internal coordinate system.

### `scoreview.module.css` additions

`.chart` (or `.chartWrapper`): `width: 100%; height: 140px; margin-bottom: 1em;` — matches the existing `.summary`'s bottom margin so spacing stays consistent with the rest of the panel.

### `scoreview.test.ts` additions

happy-dom builds SVG DOM nodes fine even though it can't do real layout/
rendering — assert structure, not visuals:
- Zero buckets: no `<svg>` rendered (or it's `hidden`/absent — match
  whatever the empty-state list already does for consistency).
- One bucket: exactly one `<circle>`, no `<polyline>`.
- Multiple buckets: `<circle>` count equals bucket count, `<polyline>`
  present with that many comma-separated point pairs in its `points`
  attribute.
- Each `<circle>`'s `<title>` child contains the right week's total (spot
  check one).

## Files touched

`src/scoreview/scoreview.ts`, `src/scoreview/scoreview.module.css`,
`src/scoreview/scoreview.test.ts`. Nothing else — no new files, no new
dependency, no changes outside this one component.

## Process

Single Haiku subagent, this plan file as spec. Same re-verification
pattern as every other round this session (read the diff, run `npx tsc
--noEmit` and `npx vitest run` myself afterward). This is smaller/more
contained than most rounds today — real content, one file, no cross-file
wiring — so a clean one-shot is plausible.

## Verification

- `npx tsc --noEmit` clean, `npx vitest run` all passing.
- Manual check still worth it once merged: open the drawer with real
  history data (a mix of a few different weeks' totals, including a week
  with 0), confirm the line actually tracks the list's numbers rather than
  just "looking plausible" — no way to visually verify an SVG's rendered
  shape without a real browser.
