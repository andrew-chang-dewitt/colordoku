/**
 * A generic "spotlight one element and say something about it" overlay primitive.
 * Knows nothing about the tutorial's content — the tutorial owns the script,
 * the callout owns geometry, layering, focus, and button interactions.
 *
 * Renders four frame rects dimming everything around a target (or the whole page
 * if no target), a transparent shield over the target (optional), a ring on the
 * target's outline, and a bubble with text + actions. Uses `position: fixed`
 * layering, not `<dialog>` + `::backdrop` (which would cover the target and
 * defeat the spotlight effect).
 */

import classes from "./callout.module.css";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Placement = "top" | "bottom" | "left" | "right" | "sheet" | "center";

export interface CalloutAction {
  label: string;
  kind: "primary" | "secondary";
  onClick: () => void;
}

export interface CalloutStepView {
  title?: string;
  /** Trusted, in-repo markup (allows <strong>/<code>) — never player input. */
  body: string;
  /** Element the ring + bubble point at. Omit for a centered, unanchored step. */
  anchor?: HTMLElement | null;
  /** Region left undimmed. Defaults to `anchor`. */
  cutout?: HTMLElement | null;
  /** true → the cutout stays clickable (Act 2's panel). false (default) →
   *  a transparent shield covers the cutout so a highlighted real-page
   *  element is visible but inert. */
  interactive?: boolean;
  placement?: Placement; // preferred; auto-flips/clamps
  actions: CalloutAction[]; // { label, kind: "primary"|"secondary", onClick }
  progress?: { current: number; total: number };
}

export interface Callout {
  html: HTMLDivElement;
  show(step: CalloutStepView): void;
  hide(): void;
  /** Re-measures and re-places; call after mounting/removing the panel. */
  reposition(): void;
  isOpen(): boolean;
  dispose(): void; // removes resize/scroll/keydown listeners
}

/**
 * The 4 rects tiling `viewport` minus `hole`; degenerate rects are dropped.
 * Used by the dimming overlay to darken everything except the target.
 */
export function frameRects(hole: Rect | null, viewport: Rect): Rect[] {
  if (hole === null) {
    return [viewport];
  }

  const rects: Rect[] = [];

  // Top rect: from viewport top to hole top
  if (hole.top > viewport.top) {
    rects.push({
      top: viewport.top,
      left: viewport.left,
      width: viewport.width,
      height: hole.top - viewport.top,
    });
  }

  // Bottom rect: from hole bottom to viewport bottom
  const holeBottom = hole.top + hole.height;
  const viewportBottom = viewport.top + viewport.height;
  if (holeBottom < viewportBottom) {
    rects.push({
      top: holeBottom,
      left: viewport.left,
      width: viewport.width,
      height: viewportBottom - holeBottom,
    });
  }

  // Left rect: from viewport left to hole left (within the hole's vertical range)
  if (hole.left > viewport.left) {
    rects.push({
      top: hole.top,
      left: viewport.left,
      width: hole.left - viewport.left,
      height: hole.height,
    });
  }

  // Right rect: from hole right to viewport right (within the hole's vertical range)
  const holeRight = hole.left + hole.width;
  const viewportRight = viewport.left + viewport.width;
  if (holeRight < viewportRight) {
    rects.push({
      top: hole.top,
      left: holeRight,
      width: viewportRight - holeRight,
      height: hole.height,
    });
  }

  return rects;
}

/**
 * Preferred placement, flipped to the opposite side if it would overflow,
 * clamped into the viewport with a margin. A null anchor (nothing to point
 * at — an unanchored step like the tutorial's welcome screen) centers the
 * bubble in the viewport instead of trying to place it relative to
 * anything. Falls back to "sheet" (full-width, pinned to the bottom) on
 * narrow viewports or when nothing else fits *and there is a real anchor* —
 * a null anchor never falls back to sheet, since there's nothing there to
 * need room around. Returns the arrow offset too, so the arrow tracks the
 * anchor after clamping.
 */
export function placeBubble(
  anchor: Rect | null,
  bubble: { width: number; height: number },
  viewport: Rect,
  preferred: Placement,
  gap: number,
): {
  top: number;
  left: number;
  placement: Placement;
  arrowOffset: number;
} {
  const MARGIN = 16;
  const SHEET_THRESHOLD = 480; // switch to sheet mode on narrower viewports

  if (anchor === null) {
    return {
      top: viewport.top + (viewport.height - bubble.height) / 2,
      left: viewport.left + (viewport.width - bubble.width) / 2,
      placement: "center",
      arrowOffset: 0,
    };
  }

  // Narrow viewport: use sheet mode even though a real anchor exists.
  if (viewport.width < SHEET_THRESHOLD) {
    return {
      top: viewport.top + viewport.height - bubble.height,
      left: viewport.left + MARGIN,
      placement: "sheet",
      arrowOffset: 0,
    };
  }

  // Anchor center for arrow positioning
  const anchorCenterX = anchor.left + anchor.width / 2;

  // Try placements in order: preferred, opposite, then sheet
  const placements: Placement[] = [preferred];
  if (preferred === "top") placements.push("bottom");
  else if (preferred === "bottom") placements.push("top");
  else if (preferred === "left") placements.push("right");
  else if (preferred === "right") placements.push("left");
  placements.push("sheet");

  for (const placement of placements) {
    let top = 0;
    let left = 0;
    let fits = false;

    if (placement === "top") {
      top = anchor.top - gap - bubble.height;
      left = anchorCenterX - bubble.width / 2;
      fits =
        top >= viewport.top + MARGIN &&
        left >= viewport.left + MARGIN &&
        left + bubble.width <= viewport.left + viewport.width - MARGIN;
    } else if (placement === "bottom") {
      top = anchor.top + anchor.height + gap;
      left = anchorCenterX - bubble.width / 2;
      fits =
        top + bubble.height <= viewport.top + viewport.height - MARGIN &&
        left >= viewport.left + MARGIN &&
        left + bubble.width <= viewport.left + viewport.width - MARGIN;
    } else if (placement === "left") {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.left - gap - bubble.width;
      fits =
        left >= viewport.left + MARGIN &&
        top >= viewport.top + MARGIN &&
        top + bubble.height <= viewport.top + viewport.height - MARGIN;
    } else if (placement === "right") {
      top = anchor.top + anchor.height / 2 - bubble.height / 2;
      left = anchor.left + anchor.width + gap;
      fits =
        left + bubble.width <= viewport.left + viewport.width - MARGIN &&
        top >= viewport.top + MARGIN &&
        top + bubble.height <= viewport.top + viewport.height - MARGIN;
    } else if (placement === "sheet") {
      top = viewport.top + viewport.height - bubble.height;
      left = viewport.left + MARGIN;
      fits = true; // sheet always fits
    }

    if (fits) {
      // Clamp into viewport
      left = Math.max(
        viewport.left + MARGIN,
        Math.min(left, viewport.left + viewport.width - bubble.width - MARGIN),
      );
      top = Math.max(
        viewport.top + MARGIN,
        Math.min(top, viewport.top + viewport.height - bubble.height - MARGIN),
      );

      // Calculate arrow offset (relative to bubble, centered by default)
      let arrowOffset = 0;
      if (placement === "top" || placement === "bottom") {
        // Horizontal arrow, offset it to point at anchor
        arrowOffset = Math.max(-10, Math.min(bubble.width - 20, anchorCenterX - left - bubble.width / 2));
      }

      return { top, left, placement, arrowOffset };
    }
  }

  // Fallback to sheet (should not reach here given sheet always fits)
  return {
    top: viewport.top + viewport.height - bubble.height,
    left: viewport.left + MARGIN,
    placement: "sheet",
    arrowOffset: 0,
  };
}

export function newCallout(config: { onDismiss: () => void }): Callout {
  const root = document.createElement("div");
  root.className = classes.root;

  const frames: HTMLDivElement[] = [];
  const shield = document.createElement("div");
  shield.className = classes.shield;
  root.append(shield);

  const ring = document.createElement("div");
  ring.className = classes.ring;
  root.append(ring);

  const bubble = document.createElement("div");
  bubble.className = classes.bubble;
  bubble.setAttribute("role", "dialog");
  bubble.setAttribute("aria-modal", "true");
  root.append(bubble);

  let isOpen = false;
  let savedActiveElement: Element | null = null;
  let resizeListener: (() => void) | null = null;
  let scrollListener: (() => void) | null = null;
  let keyListener: ((e: KeyboardEvent) => void) | null = null;
  let currentStep: CalloutStepView | null = null;

  /**
   * Re-measures the anchor/cutout and re-lays-out the frames, shield, ring,
   * and bubble position for `step` — everything geometry-dependent. Shared
   * by show() (after building the bubble's content) and reposition() (which
   * only needs to redo geometry against the *current* step, not rebuild
   * content/listeners) so a resize/scroll mid-step doesn't leave stale
   * positions behind.
   */
  function renderGeometry(step: CalloutStepView): void {
    // Clear previous frames
    for (const frame of frames) {
      frame.remove();
    }
    frames.length = 0;

    // Get viewport and target rects
    const viewport: Rect = {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let anchorRect: Rect | null = null;
    let cutoutRect: Rect | null = null;

    if (step.anchor) {
      const rect = step.anchor.getBoundingClientRect();
      anchorRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }

    const cutoutEl = step.cutout ?? step.anchor;
    if (cutoutEl) {
      const rect = cutoutEl.getBoundingClientRect();
      cutoutRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }

    // Render dimming frames around the cutout
    const frameRectList = frameRects(cutoutRect, viewport);
    for (const frameRect of frameRectList) {
      const frame = document.createElement("div");
      frame.className = classes.frame;
      frame.style.top = `${frameRect.top}px`;
      frame.style.left = `${frameRect.left}px`;
      frame.style.width = `${frameRect.width}px`;
      frame.style.height = `${frameRect.height}px`;
      root.append(frame);
      frames.push(frame);
    }

    // Shield: transparent rect over cutout (if not interactive)
    if (!step.interactive && cutoutRect) {
      shield.style.display = "block";
      shield.style.top = `${cutoutRect.top}px`;
      shield.style.left = `${cutoutRect.left}px`;
      shield.style.width = `${cutoutRect.width}px`;
      shield.style.height = `${cutoutRect.height}px`;
    } else {
      shield.style.display = "none";
    }

    // Ring: outline on anchor
    if (anchorRect) {
      ring.style.display = "block";
      ring.style.top = `${anchorRect.top}px`;
      ring.style.left = `${anchorRect.left}px`;
      ring.style.width = `${anchorRect.width}px`;
      ring.style.height = `${anchorRect.height}px`;
    } else {
      ring.style.display = "none";
    }

    // Position bubble
    const bubbleSize = {
      width: Math.max(280, Math.min(500, window.innerWidth - 32)),
      height: bubble.offsetHeight || 300, // real height once rendered once; estimate before that
    };

    const placement = placeBubble(
      anchorRect,
      bubbleSize,
      viewport,
      step.placement ?? "bottom",
      12,
    );

    bubble.style.top = `${placement.top}px`;
    bubble.style.left = `${placement.left}px`;
    bubble.setAttribute("data-placement", placement.placement);
  }

  function show(step: CalloutStepView): void {
    isOpen = true;
    currentStep = step;

    if (!savedActiveElement && document.activeElement) {
      savedActiveElement = document.activeElement;
    }

    // Bubble: title + body + actions
    bubble.innerHTML = "";

    if (step.progress) {
      const progressEl = document.createElement("div");
      progressEl.className = classes.progress;
      progressEl.textContent = `Step ${step.progress.current} of ${step.progress.total}`;
      bubble.append(progressEl);
    }

    if (step.title) {
      const titleEl = document.createElement("h3");
      titleEl.className = classes.title;
      titleEl.textContent = step.title;
      bubble.append(titleEl);
    }

    const bodyEl = document.createElement("p");
    bodyEl.className = classes.body;
    bodyEl.innerHTML = step.body;
    bubble.append(bodyEl);

    const actionsEl = document.createElement("div");
    actionsEl.className = classes.actions;

    let firstAction: HTMLButtonElement | null = null;
    for (const action of step.actions) {
      const btn = document.createElement("button");
      btn.className = `btn btn-${action.kind}`;
      btn.textContent = action.label;
      btn.addEventListener("click", action.onClick);
      actionsEl.append(btn);

      if (!firstAction) {
        firstAction = btn;
      }
    }

    bubble.append(actionsEl);

    // Set aria labels
    if (step.title) {
      bubble.setAttribute("aria-labelledby", "callout-title");
    }
    if (step.body) {
      bubble.setAttribute("aria-describedby", "callout-body");
    }

    renderGeometry(step);

    // Move focus to first action
    if (firstAction) {
      setTimeout(() => firstAction!.focus(), 0);
    }

    // Set up listeners if not already done
    if (!resizeListener) {
      resizeListener = () => reposition();
      scrollListener = () => reposition();
      keyListener = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isOpen) {
          e.stopPropagation();
          config.onDismiss();
        }
      };

      window.addEventListener("resize", resizeListener);
      document.addEventListener("scroll", scrollListener, true);
      document.addEventListener("keydown", keyListener, true);
    }
  }

  function hide(): void {
    isOpen = false;
    currentStep = null;
    bubble.innerHTML = "";
    ring.style.display = "none";
    shield.style.display = "none";

    for (const frame of frames) {
      frame.remove();
    }
    frames.length = 0;

    // Restore focus
    if (savedActiveElement && savedActiveElement instanceof HTMLElement) {
      savedActiveElement.focus();
    }
  }

  function reposition(): void {
    if (!isOpen || currentStep === null) return;
    renderGeometry(currentStep);
  }

  return {
    html: root,
    show,
    hide,
    reposition,
    isOpen: () => isOpen,
    dispose: () => {
      if (resizeListener) {
        window.removeEventListener("resize", resizeListener);
      }
      if (scrollListener) {
        document.removeEventListener("scroll", scrollListener, true);
      }
      if (keyListener) {
        document.removeEventListener("keydown", keyListener, true);
      }
    },
  };
}
