# Confetti gravity follows device rotation

## Context

User's own framing: "probably overkill/ridiculous." Confetti's fall
direction should react live to the device physically rotating — rotate the
phone, gravity redirects toward the new "down," including pieces already
mid-flight.

Two open questions were resolved via direct answers:
1. **In-flight pieces redirect live**, not just future bursts. This can't
   be done with the current implementation's architecture — see below.
2. **Pieces that exit the screen under rotated gravity are lost** (removed),
   not bounced off a "reinterpreted" floor.

**Sequencing dependency**: this must be implemented *after* the
bounce-and-settle confetti round (already landed this session) and after
the win-modal `weeklyScore` addition (currently blocked on committing
`src/gameover/*`) — not in parallel, same file/function.

## Why this needs an architecture change, not just an event listener

Confetti's motion is built as **precomputed Web Animations API
keyframes**: at launch, the whole trajectory is calculated up front as an
array of `{transform, opacity, offset}` points, handed to
`piece.animate(keyframes, {...})`, and the browser interpolates between
them on its own compositor thread from then on. There is no per-frame JS
hook into an in-progress WAAPI animation — once started, its whole future
path is fixed. "Redirect a piece that's already falling" is therefore
impossible with that approach; the only way to react to a live rotation
event mid-flight is to drive the motion from JS every frame instead,
via `requestAnimationFrame`, so each frame can read the current gravity
direction and integrate from wherever the piece currently is.

This plan replaces `createConfetti()`'s per-piece
`piece.animate(keyframes, ...)` call with a **shared rAF loop** driving all
active pieces' positions via direct `piece.style.transform` writes.

## Design

### 1. Gravity direction state (`src/gameover/gameover.ts`, module-level inside `newGameOver`)

```ts
let gravityAngleDeg = 0; // 0 = straight down, matches today's default
```

Listen for physical rotation via `screen.orientation`'s `change` event
(feature-detected — not implemented in the happy-dom test environment, and
not universally on desktop, so guard with
`if (typeof screen !== "undefined" && screen.orientation) { ... }`, same
defensive style the codebase already uses for `piece.animate`
feature-detection):

```ts
let lastOrientationAngle = screen.orientation?.angle ?? 0;
screen.orientation?.addEventListener("change", () => {
  const newAngle = screen.orientation.angle;
  const delta = newAngle - lastOrientationAngle;
  gravityAngleDeg = (gravityAngleDeg - delta + 360) % 360; // rotate opposite the screen's own rotation, so gravity keeps pointing toward the user's physical "down"
  lastOrientationAngle = newAngle;
});
```

Attached once at `newGameOver` construction time, same lifetime as the
existing `close` listener — no dispose needed, matching this module's
existing "one instance per page load" convention.

Gravity vector for the simulation: `gx = g * Math.sin(gravityAngleDeg * Math.PI / 180)`,
`gy = g * Math.cos(gravityAngleDeg * Math.PI / 180)` (at `gravityAngleDeg =
0` this reduces to today's straight-down `gy = g, gx = 0`).

### 2. Rewrite `createConfetti()`'s animation mechanism

Keep unchanged: launch point (card top-center), per-piece launch angle/speed
sampling, color/jitter, piece count/screen-width scaling,
`prefers-reduced-motion` early-return.

Replace the "build keyframes, call `piece.animate`" tail with:

- Each piece becomes a small state object: `{ el, x, y, vx, vy, settled,
  settleAt, removed }` (position/velocity in the same "offset from launch
  point" coordinate space the current keyframes already use), pushed into a
  shared `activePieces: PieceState[]` array.
- One shared driver, started lazily on first use and stopped when
  `activePieces` empties:
  ```ts
  let rafHandle: number | null = null;
  let lastFrameTime = 0;
  function tick(now: number): void {
    const dt = Math.min(0.05, (now - lastFrameTime) / 1000); // clamp dt so a dropped/backgrounded frame can't produce a huge physics jump
    lastFrameTime = now;
    for (const piece of activePieces) stepPiece(piece, dt);
    activePieces = activePieces.filter((p) => !p.removed);
    if (activePieces.length > 0) {
      rafHandle = requestAnimationFrame(tick);
    } else {
      rafHandle = null;
    }
  }
  function ensureLoopRunning(): void {
    if (rafHandle === null) {
      lastFrameTime = performance.now();
      rafHandle = requestAnimationFrame(tick);
    }
  }
  ```
- `stepPiece(piece, dt)` per-frame physics, using the **current**
  `gx`/`gy` (recomputed from `gravityAngleDeg` each call, so a rotation
  mid-flight is picked up on the very next frame):
  - If not yet settled: `vx += gx * dt; vy += gy * dt; piece.x += vx * dt; piece.y += vy * dt;`.
  - **Reconciling with the bounce/settle feature**: preserve that
    feature's floor-bounce behavior only while `gravityAngleDeg === 0`
    (the default, no rotation has happened yet) — reuse its exact
    constants/logic (restitution, `MIN_BOUNCE_SPEED`, hold, fade) for that
    case. The moment `gravityAngleDeg` has ever changed from `0` (a
    rotation has occurred), stop applying floor/bounce logic entirely for
    every active piece (settled or not) and switch to plain "keep
    integrating position; remove once out of viewport bounds" — this is
    what satisfies both answers together: rotation is rare/exceptional, so
    the common case (nobody rotates their phone) keeps today's
    bounce-and-settle look untouched, while an actual rotation event
    immediately abandons the "floor" concept (which has no single sane
    definition once gravity can point any direction) in favor of "fall
    off-edge and vanish," exactly as chosen.
  - Removal check (once in "rotated" mode, or always for a piece that's
    already fading out normally): compute absolute screen position
    (`actualLaunchX + piece.x`, `actualLaunchY + piece.y`); if it's outside
    `[-20, viewportWidth + 20]` horizontally or `[-20, viewportHeight +
    20]` vertically (small margin so removal isn't visible as a pop), mark
    `piece.removed = true` and call `piece.el.remove()`.
  - Opacity/fade: keep the existing bounce/settle feature's hold+fade
    timing when in the unrotated/settled path; a piece removed via
    off-screen exit in rotated mode doesn't need a fade at all (it's gone
    the instant it's off-screen, matching "falls off and is lost").
  - Every frame, write position directly:
    `piece.el.style.transform = \`translate(${actualLaunchX + piece.x}px, ${actualLaunchY + piece.y}px)\`` (and update opacity via `piece.el.style.opacity` when fading).
- On each `createConfetti()` call: clear `activePieces` and cancel any
  running `rafHandle` first (mirrors the existing "clear existing confetti"
  step already at the top of the function), and reset `gravityAngleDeg = 0`
  for the new burst (each win starts fresh — a rotation from a *previous*
  win shouldn't carry over and skip the bounce/settle look on a new one).
- `html`'s existing `"close"` listener (clears `confettiHtml.innerHTML`)
  must also cancel `rafHandle` and clear `activePieces`, so closing the
  modal mid-animation actually stops the loop instead of leaving a
  detached rAF running against removed DOM nodes.
- The old `piece.animate`-unavailable fallback branch (`setTimeout`-based
  removal, for environments without WAAPI) is no longer needed — rAF is
  the only animation mechanism now. Confirm `requestAnimationFrame` is
  available in the vitest/happy-dom test environment; if not, the tests
  will need a minimal polyfill/mock (check how other timing-sensitive tests
  in this codebase handle it, e.g. `timer.ts`'s tests, before inventing a
  new approach).

### 3. Testing reality check

`getBoundingClientRect()` and `screen.orientation` are both effectively
inert/zeroed in happy-dom (same limitation noted in every prior confetti
round this session). Tests should assert structure/lifecycle, not real
physics or real angles: that the rAF loop starts and eventually stops
(`activePieces` empties) after a win, that triggering a mocked
`screen.orientation` `change` event doesn't throw and updates
`gravityAngleDeg`'s effect observably (e.g. by checking a piece's `vx`/`vy`
changed sign/direction after the event, not by checking real pixel
positions), and that closing the dialog mid-animation cancels the loop
(no error, `activePieces` cleared). Existing tests
(`confettiHtml.children.length` before/after `show()`) should still pass
largely unchanged.

## Files touched

Only `src/gameover/gameover.ts` and `src/gameover/gameover.test.ts`. No CSS
changes expected (`.confetti`'s existing `overflow: hidden` already clips
anything animating outside its bounds, which is all this needs visually).

## Process

**Do not spawn this until `src/gameover/*` is free** (committed, and the
win-modal `weeklyScore` line already landed — this plan's "reconciling with
bounce/settle" section depends on reading that code's actual final state
first, not assuming it from this plan's description). Once clear: single
Haiku subagent, this plan file as spec, same re-verification pattern as
every prior round (read the diff, run `npx tsc --noEmit` and `npx vitest
run` myself afterward). Given the architectural size of this change (full
animation-engine swap, not a tweak), expect a correction pass is more
likely than not.

## Verification

- `npx tsc --noEmit` clean, `npx vitest run` all passing.
- Real-device check needed for the actual payoff here (does confetti
  visibly redirect on a physical rotation) — no way to simulate a real
  `screen.orientation` "change" event or verify visually without a real
  device. This is the part most worth checking by hand once implemented.
