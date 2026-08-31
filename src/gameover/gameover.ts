import classes from "./gameover.module.css";
import { formatElapsed } from "../timer/timer";
import { newShareButton } from "../share/share";

export interface GameOverResult {
  state: 1 | 2; // won, lost
  elapsedMs: number;
  score: number;
  size: number;
  /** Cumulative score for the current week, including this game's own score. */
  weeklyScore: number;
}

export interface GameOver {
  html: HTMLDialogElement;
  confettiHtml: HTMLDivElement;
  /** Opens the modal with win/loss-specific messaging. */
  show: (result: GameOverResult) => void;
}

export interface GameOverConfig {
  /** Start a fresh board at the same size. */
  onNewGame: () => void;
  /** Go to the options drawer to change size before starting. */
  onChangeOptions: () => void;
  /** Replay the same board (called by "Try again" button on loss). */
  onTryAgain: () => void;
  /** Called fresh on every click to get the share URL. */
  getShareUrl: () => string;
}

/**
 * The game-over interstitial. Unlike options.ts's drawer, this has no
 * dismissable state at all: Escape and backdrop clicks are always ignored, so
 * the player must pick one of the two actions rather than idle on a dead
 * board. <dialog> + showModal() is reused for the same reason it is in
 * options.ts — the board underneath becomes genuinely inert, not just
 * visually dimmed, which matters here because unguessed cells are still
 * clickable once the game has technically ended.
 */
export function newGameOver({
  onNewGame,
  onChangeOptions,
  onTryAgain,
  getShareUrl,
}: GameOverConfig): GameOver {
  const html = document.createElement("dialog");
  html.className = classes.modal;

  // Full-viewport, so it isn't clipped to the card's small bounding box; a
  // child of the dialog (not document.body), so it shares the dialog's own
  // top-layer stacking context and renders above ::backdrop's dimming
  // instead of underneath it.
  const confettiHtml = document.createElement("div");
  confettiHtml.className = classes.confetti;
  html.append(confettiHtml);

  // The actual visible card — separated from the dialog element itself so
  // the dialog can be a full-viewport transparent shell (for confetti to
  // fill) while the card keeps the original centered, bordered modal look.
  const card = document.createElement("div");
  card.className = classes.card;
  html.append(card);

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  card.append(heading);

  const message = document.createElement("p");
  message.className = classes.message;

  const score = document.createElement("p");
  score.className = classes.score;

  let shareSize = 4; // Default, will be set in show()
  let shareElapsedMs = 0; // Default, will be set in show()
  let shareScore = 0; // Default, will be set in show()

  const shareButton = newShareButton({
    getUrl: getShareUrl,
    title: "Share",
    text: () =>
      `I solved a ${shareSize}x${shareSize} Colordoku in ${formatElapsed(
        shareElapsedMs
      )} — score ${shareScore}!`,
  });

  const summaryRow = document.createElement("div");
  summaryRow.className = classes.summaryRow;
  summaryRow.append(message, score, shareButton.html);
  card.append(summaryRow);

  const weeklyScore = document.createElement("p");
  weeklyScore.className = classes.weeklyScore;
  card.append(weeklyScore);

  const actions = document.createElement("div");
  actions.className = classes.actions;

  const tryAgain = document.createElement("button");
  tryAgain.type = "button";
  tryAgain.className = "btn btn-secondary";
  tryAgain.textContent = "Try again";
  tryAgain.addEventListener("click", () => {
    html.close();
    onTryAgain();
  });
  actions.append(tryAgain);

  const changeOptions = document.createElement("button");
  changeOptions.type = "button";
  changeOptions.className = "btn btn-secondary";
  changeOptions.textContent = "Change size…";
  changeOptions.addEventListener("click", () => {
    html.close();
    onChangeOptions();
  });
  actions.append(changeOptions);

  const newGame = document.createElement("button");
  newGame.type = "button";
  newGame.className = "btn btn-primary";
  newGame.textContent = "New game, same size";
  newGame.addEventListener("click", () => {
    html.close();
    onNewGame();
  });
  actions.append(newGame);

  card.append(actions);

  html.addEventListener("cancel", (event) => event.preventDefault());

  // Clear confetti when the dialog closes
  html.addEventListener("close", () => {
    confettiHtml.innerHTML = "";
  });

  function createConfetti(): void {
    // Respect prefers-reduced-motion: skip creating confetti if motion is reduced
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Clear existing confetti
    confettiHtml.innerHTML = "";

    // Launch point: top-center of the card
    const cardRect = card.getBoundingClientRect();
    const launchX = cardRect.left + cardRect.width / 2;
    const launchY = cardRect.top;

    // Baseline (mobile) piece count is double the original 24-40 range;
    // scaled further by viewport width so desktop doesn't look sparse.
    const screenScale = Math.max(1, Math.min(3.5, window.innerWidth / 500));
    const confettiCount = Math.round((Math.random() * 32 + 48) * screenScale);
    const colors = Array.from(
      { length: 16 },
      (_, i) => `var(--color-confetti-${i})`
    );

    const gravity = 800; // pixels per second²

    // Distance to top edge (for calculating threshold launch speed)
    const distanceToTop = launchY;

    // Threshold speed to just reach the top edge
    const vTop = Math.sqrt(2 * gravity * distanceToTop);


    for (let i = 0; i < confettiCount; i++) {
      const piece = document.createElement("span");
      piece.className = classes.confettiPiece;

      // Random color from the palette
      const color = colors[Math.floor(Math.random() * colors.length)];
      piece.style.setProperty("--color", color);

      // Small jitter on launch position (±2-3px)
      const jitterX = (Math.random() - 0.5) * 6; // ±3px
      const jitterY = (Math.random() - 0.5) * 4; // ±2px
      const actualLaunchX = launchX + jitterX;
      const actualLaunchY = launchY + jitterY;

      // Launch angle: centered on straight up (90°), with tent distribution spread
      // Tent distribution: average two uniform randoms for more concentration near center
      const spreadRange = 30; // ±30° from vertical
      const tent = (Math.random() + Math.random()) / 2; // 0 to 1, peaked at 0.5
      const angle = 90 + (tent - 0.5) * 2 * spreadRange; // ranges 60° to 120°
      const angleRad = (angle * Math.PI) / 180;

      // Vertical launch speed: sample between 0.75*vTop and 1.35*vTop
      // This ensures roughly 10-30% of pieces exceed the top edge
      const vSpeedFactor = 0.75 + Math.random() * 0.6;
      const vSpeed = vSpeedFactor * vTop;
      const vx = Math.cos(angleRad) * vSpeed;
      const vy = -Math.sin(angleRad) * vSpeed; // Negative = upward

      // Animation delay (stagger the starts)
      const delay = Math.random() * 0.1;

      // Physics simulation: bouncing and settling
      const RESTITUTION = 0.45;
      const MIN_BOUNCE_SPEED = 60;
      const HOLD_SECONDS = 10.0;
      const FADE_SECONDS = 0.6;
      const MAX_DURATION = 15.0; // must exceed HOLD_SECONDS + FADE_SECONDS plus bounce time, or the settle/fade phase gets cut short
      const dt = 0.05; // 20 samples/sec for bounce/flight phase (coarser than old 0.032)

      // Piece rests right at the bottom edge of the viewport (small offset
      // is roughly half the piece's own height, ~6px, so it sits on the
      // edge rather than centered past it).
      const floorY = Math.max(0, window.innerHeight - launchY - 3);

      let t = 0;
      let x = 0;
      let y = 0;
      let vx_sim = vx;
      let vy_sim = vy;
      let settled = false;
      let settledTime = 0;

      interface KeyframeData {
        transform: string;
        opacity: number;
        time: number;
      }
      const keyframeData: KeyframeData[] = [];

      // Initial keyframe
      keyframeData.push({
        transform: `translate(${actualLaunchX + x}px, ${actualLaunchY + y}px)`,
        opacity: 1,
        time: 0,
      });

      // Physics simulation loop: bounce/flight phase only
      while (t < MAX_DURATION) {
        // Physics step: integrate (unless already settled)
        if (!settled) {
          vy_sim += gravity * dt;
          y += vy_sim * dt;
          x += vx_sim * dt;

          // Check for floor collision
          if (y >= floorY) {
            // Bounce with damping
            vy_sim = -vy_sim * RESTITUTION;
            vx_sim *= 0.7;
            y = floorY; // Clamp to floor

            // Check if we should settle
            if (Math.abs(vy_sim) < MIN_BOUNCE_SPEED) {
              settled = true;
              settledTime = t;
              vy_sim = 0;

              // Push final keyframe at settle moment
              keyframeData.push({
                transform: `translate(${actualLaunchX + x}px, ${actualLaunchY + y}px)`,
                opacity: 1,
                time: t,
              });

              // Hold phase: push exactly one keyframe at settledTime + HOLD_SECONDS
              // Same transform/opacity as settle moment; WAAPI interpolates identical values as no-op
              keyframeData.push({
                transform: `translate(${actualLaunchX + x}px, ${actualLaunchY + y}px)`,
                opacity: 1,
                time: settledTime + HOLD_SECONDS,
              });

              // Fade phase: push one final keyframe at settledTime + HOLD_SECONDS + FADE_SECONDS
              // Same transform, opacity: 0; linear interpolation produces the fade
              keyframeData.push({
                transform: `translate(${actualLaunchX + x}px, ${actualLaunchY + y}px)`,
                opacity: 0,
                time: settledTime + HOLD_SECONDS + FADE_SECONDS,
              });

              // Stop looping; hold+fade phases are now represented by single keyframes each
              break;
            }
          }

          // Push keyframe only during bounce/flight phase (before settling)
          keyframeData.push({
            transform: `translate(${actualLaunchX + x}px, ${actualLaunchY + y}px)`,
            opacity: 1,
            time: t,
          });
        }

        t += dt;
      }

      // Convert to animation keyframes with normalized offsets. Use the
      // *last keyframe's* own time, not the loop's final `t` — when a piece
      // settles, the loop breaks right after pushing the hold/fade
      // keyframes (at settledTime + HOLD_SECONDS + FADE_SECONDS) without
      // ever advancing `t` that far, so `t` alone would understate the
      // real duration and push those keyframes' offsets past 1.
      const duration = keyframeData[keyframeData.length - 1].time;
      const keyframes: Keyframe[] = keyframeData.map((kf) => ({
        transform: kf.transform,
        opacity: kf.opacity,
        offset: duration > 0 ? kf.time / duration : 0,
      }));

      confettiHtml.append(piece);

      // Set initial position via transform (also covers environments without
      // Web Animations API, where the keyframes below never apply)
      piece.style.transform = `translate(${actualLaunchX}px, ${actualLaunchY}px)`;

      // Play the animation using Web Animations API (if available)
      if (piece.animate) {
        const animation = piece.animate(keyframes, {
          duration: duration * 1000,
          delay: delay * 1000,
          easing: "linear",
          fill: "forwards",
        });

        // Remove piece when animation finishes
        animation.addEventListener("finish", () => {
          piece.remove();
        });
      } else {
        // Fallback for environments without Web Animations API (e.g., jsdom in tests)
        // Just remove the piece after the calculated duration
        setTimeout(() => {
          piece.remove();
        }, (duration + delay) * 1000);
      }
    }
  }

  return {
    html,
    confettiHtml,

    show({ state, elapsedMs, score: scoreValue, size, weeklyScore: weeklyScoreValue }) {
      const won = state === 1;
      html.classList.toggle(classes.won, won);
      html.classList.toggle(classes.lost, !won);
      heading.textContent = won ? "You won!" : "Out of guesses";
      message.textContent = won
        ? `Solved in ${formatElapsed(elapsedMs)}`
        : "No guesses left — better luck next time.";

      // Update share text variables for dynamic share message
      shareSize = size;
      shareElapsedMs = elapsedMs;
      shareScore = scoreValue;

      // Score line: shown only on win
      score.hidden = !won;
      if (won) {
        score.textContent = `Score: ${scoreValue}`;
      }

      // Weekly cumulative score line: shown only on win, alongside the per-game score
      weeklyScore.hidden = !won;
      if (won) {
        weeklyScore.textContent = `This week: ${weeklyScoreValue}`;
      }

      // Open dialog BEFORE starting animations on confetti, so they start on rendered elements
      if (!html.open) html.showModal();

      // Confetti: plays only on win
      if (won) {
        createConfetti();
      } else {
        confettiHtml.innerHTML = "";
      }

      // Share button: shown only on win
      shareButton.html.hidden = !won;

      // Try again button: shown only on loss
      tryAgain.hidden = won;
    },
  };
}
