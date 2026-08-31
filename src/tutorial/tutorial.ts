/**
 * Tutorial controller: drives the presentation, step transitions, and interactions.
 * Reuses callout.ts for the overlay geometry and step rendering, and script.ts
 * for the step data. Owns the TutorialBoard lifecycle.
 */

import { newCallout, type Callout } from "../callout/callout";
import {
  markTutorialStarted,
  markTutorialProgress,
  markTutorialCompleted,
  markTutorialSkipped,
  loadTutorial,
} from "../persistence/tutorial";
import { newTutorialBoard, type TutorialBoard } from "./board";
import { STEPS } from "./script";

export interface TutorialConfig {
  /** Resolvers, not elements: targets may not exist yet (or at all). */
  anchors: {
    userMenu: () => HTMLElement | null;
    helpButton: () => HTMLElement | null;
  };
  /** main.ts freezes the real timer here (see the pause note below). */
  onPause?: () => void;
  onResume?: () => void;
  /** Fired once, on a genuine completion (not on replay/skip) — the hook a score bonus would use. */
  onComplete?: (isFirstTime: boolean) => void;
  /** Welcome step's "Just show me the rules" choice: closes the tutorial (marked seen, same as Skip) and opens this instead. */
  onShowRules?: () => void;
}

export interface Tutorial {
  html: HTMLDivElement;
  start(reason: "first-run" | "replay"): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function newTutorial(config: TutorialConfig): Tutorial {
  const html = document.createElement("div");
  html.setAttribute("data-tutorial-root", "true");

  let callout: Callout | null = null;
  let tutorialBoard: TutorialBoard | null = null;
  let currentStep = 0;
  let isOpen = false;

  // A zero-size, invisible element the callout can anchor its ring/bubble to
  // for a multi-cell "cells" step, sized/positioned (via position: fixed, so
  // getBoundingClientRect() reports viewport coords like any real element)
  // to the bounding box of that step's cells — the ring then spans the whole
  // group instead of just the first cell.
  const virtualAnchor = document.createElement("div");
  virtualAnchor.style.position = "fixed";
  virtualAnchor.style.pointerEvents = "none";
  virtualAnchor.style.opacity = "0";
  html.append(virtualAnchor);

  function getAnchorElement() {
    const step = STEPS[currentStep];
    if (!step) return null;

    const anchor = step.anchor;
    switch (anchor.kind) {
      case "none":
        return null;
      case "userMenu":
        return config.anchors.userMenu();
      case "helpButton":
        return config.anchors.helpButton();
      case "panel":
        return tutorialBoard?.html ?? null;
      case "pips":
        return tutorialBoard?.game.html ?? null;
      case "cell": {
        const cell = tutorialBoard?.cellAt(anchor.coord);
        return cell?.html ?? null;
      }
      case "cells": {
        if (!tutorialBoard) return null;
        // Return a bounding box of all cells
        const cells = anchor.coords
          .map((c) => tutorialBoard!.cellAt(c).html)
          .filter((el) => el && el.parentElement);

        if (cells.length === 0) return null;
        if (cells.length === 1) return cells[0];

        // Position the virtual anchor over the bounding box of every cell in
        // the group, so the ring spans the whole set rather than just one.
        const first = cells[0].getBoundingClientRect();
        const bbox = cells.reduce(
          (acc, cell) => {
            const rect = cell.getBoundingClientRect();
            return {
              top: Math.min(acc.top, rect.top),
              left: Math.min(acc.left, rect.left),
              right: Math.max(acc.right, rect.right),
              bottom: Math.max(acc.bottom, rect.bottom),
            };
          },
          {
            top: first.top,
            left: first.left,
            right: first.right,
            bottom: first.bottom,
          },
        );

        virtualAnchor.style.top = `${bbox.top}px`;
        virtualAnchor.style.left = `${bbox.left}px`;
        virtualAnchor.style.width = `${bbox.right - bbox.left}px`;
        virtualAnchor.style.height = `${bbox.bottom - bbox.top}px`;
        return virtualAnchor;
      }
    }
  }

  function showStep(stepIndex: number): void {
    if (stepIndex < 0 || stepIndex >= STEPS.length) return;

    currentStep = stepIndex;
    markTutorialProgress(stepIndex);

    const step = STEPS[stepIndex];

    // Mount/unmount the practice board
    if (step.panel === "shown" && !tutorialBoard) {
      tutorialBoard = newTutorialBoard();
      html.append(tutorialBoard.html);
      if (callout) {
        callout.reposition();
      }
    } else if (step.panel === "hidden" && tutorialBoard) {
      tutorialBoard.html.remove();
      tutorialBoard.dispose();
      tutorialBoard = null;
    }

    // Run side effects (scripted auto-marks)
    if (step.enter && tutorialBoard) {
      step.enter(tutorialBoard);
    }

    // Set up the callout
    if (!callout) {
      callout = newCallout({
        onDismiss: () => {
          skipTutorial();
        },
      });
      html.append(callout.html);
    }

    // Build the step view for callout
    const anchor = getAnchorElement();

    const actions = [
      {
        label: "Next",
        kind: "secondary" as const,
        onClick: () => {
          if (step.await) {
            // This shouldn't happen if await is set
            return;
          }
          showStep(stepIndex + 1);
        },
      },
    ];

    if (currentStep === 0) {
      // Welcome step: three ways out. "Start" begins the guided walkthrough;
      // "Just the rules" and "Skip" both mark the tutorial seen (so it never
      // auto-shows again) without playing it — the only difference is that
      // "Just the rules" hands off to the help dialog's rules section
      // instead of just closing.
      actions[0].label = "Start";
      actions.unshift(
        {
          label: "Skip",
          kind: "secondary" as const,
          onClick: () => skipTutorial(),
        },
        {
          label: "Just the rules",
          kind: "secondary" as const,
          onClick: () => showRules(),
        },
      );
    } else if (currentStep === STEPS.length - 1) {
      // Last step: "Done"
      actions[0].label = "Done";
      actions[0].onClick = () => closeTutorial();
    }

    if (step.await) {
      // Add a "Show me" fallback button
      actions.unshift({
        label: "Show me",
        kind: "secondary" as const,
        onClick: () => {
          if (tutorialBoard && step.await) {
            const cell = tutorialBoard.cellAt(step.await.coord);
            if (step.await.action === "mark") {
              cell.mark(1);
            } else if (step.await.action === "commit") {
              cell.commit();
            }
          }
        },
      });

      // Remove "Next" button, will add by gesture detection
      actions.pop();
    }

    callout.show({
      title: step.title,
      body: step.body,
      anchor,
      cutout: tutorialBoard?.html,
      interactive: step.panel === "shown",
      placement: step.placement,
      actions,
      progress:
        currentStep > 0 && currentStep < STEPS.length
          ? { current: currentStep + 1, total: STEPS.length }
          : undefined,
    });

    // Set up gesture detection if awaiting
    if (step.await && tutorialBoard) {
      const expectedCell = tutorialBoard.cellAt(step.await.coord);
      tutorialBoard.allowOnly(step.await.coord);

      if (step.await.action === "commit") {
        expectedCell.onFreeze = () => {
          // allowOnly(coord) means this is the only cell a commit could
          // possibly land on, so any freeze here is the intended one —
          // right or wrong. Some steps (e.g. "mistake") deliberately target
          // a non-queen cell to demonstrate what a wrong guess does, so
          // this must not require expectedCell.state === 2.
          if (expectedCell.frozen) {
            tutorialBoard!.allowOnly(null);
            showStep(stepIndex + 1);
          }
        };
      } else if (step.await.action === "mark") {
        expectedCell.onMark = () => {
          if (expectedCell.state === 1) {
            // Marked
            tutorialBoard!.allowOnly(null);
            showStep(stepIndex + 1);
          }
        };
      }
    } else if (step.awaitWin && tutorialBoard) {
      // Wait for game.onEnd
      tutorialBoard.allowOnly(null);
      tutorialBoard.game.onEnd((state) => {
        if (state === 1) {
          // Won
          showStep(STEPS.length - 1);
        }
      });
    } else if (tutorialBoard) {
      // Not awaiting anything, allow clicks
      tutorialBoard.allowOnly(null);
    }
  }

  function showRules(): void {
    // onShowRules first, closeTutorial() second: closeTutorial() fires
    // config.onResume() as its last step, and a caller (main.ts, on the
    // no-board root URL) may use that to decide whether to proceed straight
    // to size-picking — which it should NOT do here, since the rules dialog
    // is about to take over instead. Calling onShowRules() first lets such a
    // caller flag "the rules path was taken" before onResume asks.
    config.onShowRules?.();
    // Same "mark seen, tear down" path Skip takes from the welcome step
    // (closeTutorial() marks skipped since we're not on the final step).
    closeTutorial();
  }

  function skipTutorial(): void {
    // Skip jumps to the final step (so player learns about help), then closes
    if (currentStep < STEPS.length - 1) {
      showStep(STEPS.length - 1);
    } else {
      closeTutorial();
    }
  }

  function closeTutorial(): void {
    const record = loadTutorial();
    const wasCompleted = record?.completedAt !== null && record?.completedAt !== undefined;
    let isFirstCompletion = false;

    if (currentStep === STEPS.length - 1) {
      // Reached the end
      if (!wasCompleted) {
        // First time completion
        isFirstCompletion = true;
      }
      markTutorialCompleted(currentStep);
      if (config.onComplete) {
        config.onComplete(isFirstCompletion);
      }
    } else {
      // Skipped
      markTutorialSkipped(currentStep);
    }

    isOpen = false;

    if (callout) {
      callout.hide();
      callout.dispose();
      callout = null;
    }

    if (tutorialBoard) {
      tutorialBoard.html.remove();
      tutorialBoard.dispose();
      tutorialBoard = null;
    }

    html.remove();

    if (config.onResume) {
      config.onResume();
    }
  }

  return {
    html,

    start(reason: "first-run" | "replay") {
      if (isOpen) return;
      void reason; // kept on the public API for callers' intent/logging; both paths behave identically today

      isOpen = true;
      currentStep = 0;

      if (config.onPause) {
        config.onPause();
      }

      markTutorialStarted();
      document.body.append(html);

      showStep(0);
    },

    close() {
      if (isOpen) {
        closeTutorial();
      }
    },

    isOpen() {
      return isOpen;
    },

    dispose() {
      if (callout) {
        callout.dispose();
      }
      if (tutorialBoard) {
        tutorialBoard.dispose();
      }
    },
  };
}
