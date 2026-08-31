import classes from "./help.module.css";

export interface HelpConfig {
  /** Optional. When provided, the dialog renders a "Replay the tutorial" button in its footer. Omitted (e.g. no tutorial exists yet, or in tests) → no button rendered. */
  onReplayTutorial?: () => void;
}

export interface HelpOverlay {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
}

/**
 * The icon-only "?" button that opens the help dialog. Lives here rather
 * than main.ts so the button and the dialog it opens stay in one module,
 * matching share.ts's newShareButton shape.
 */
export function newHelpButton(onOpen: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "help";
  button.className = "btn btn-secondary";
  button.setAttribute("aria-label", "Help — rules, tips & controls");

  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.style.display = "inline-flex";
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 3.4 2.5c-.7.3-1.1.9-1.1 1.7v.3"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>`;
  button.append(icon);

  button.addEventListener("click", onOpen);
  return button;
}

function section(title: string): HTMLElement {
  const el = document.createElement("section");
  el.className = classes.section;
  const heading = document.createElement("h3");
  heading.className = classes.subheading;
  heading.textContent = title;
  el.append(heading);
  return el;
}

export function newHelpOverlay(config?: HelpConfig): HelpOverlay {
  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const card = document.createElement("div");
  card.className = classes.card;

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  heading.textContent = "How to play";
  card.append(heading);

  // Section: The rules
  const rulesSection = section("The rules");
  const rulesList = document.createElement("ol");
  rulesList.className = classes.list;
  const rule1 = document.createElement("li");
  rule1.className = classes.item;
  rule1.textContent = "Every column, row, & region contains exactly 1 queen.";
  rulesList.append(rule1);
  const rule2 = document.createElement("li");
  rule2.className = classes.item;
  rule2.textContent = "No two queens can be adjacent (orthogonally or diagonally).";
  rulesList.append(rule2);
  rulesSection.append(rulesList);
  card.append(rulesSection);

  // Section: Making moves
  const movesSection = section("Making moves");
  const movesList = document.createElement("ul");
  movesList.className = classes.list;
  const moves = [
    "Single click/tap toggles an elimination mark (free, no cost)",
    "Double click/tap commits a guess (correct = locks in queen, wrong = eliminates cell + costs a guess pip)",
    "Shift + click two cells in a row/column marks the range between them",
    "Drag marks every cell along the path",
  ];
  for (const move of moves) {
    const item = document.createElement("li");
    item.className = classes.item;
    item.textContent = move;
    movesList.append(item);
  }
  movesSection.append(movesList);
  card.append(movesSection);

  // Section: Strategy tips
  const tipsSection = section("Strategy tips");
  const tipsList = document.createElement("ul");
  tipsList.className = classes.list;
  const tips = [
    "Start with the smallest region — it has the fewest possible locations for a queen",
    "After placing a queen, mark its entire row, column, and 8 adjacent neighbors as eliminated",
    "A region confined to one row or column claims that row or column's only queen",
    "Watch for a region, row, or column with exactly one unmarked cell left — that must be the queen",
    "When uncertain, mark cells as eliminated rather than guessing — you can eliminate strategically without cost",
  ];
  for (const tip of tips) {
    const item = document.createElement("li");
    item.className = classes.item;
    item.textContent = tip;
    tipsList.append(item);
  }
  tipsSection.append(tipsList);
  card.append(tipsSection);

  // Section: Keyboard controls
  const keyboardSection = section("Keyboard controls");
  const keyboardList = document.createElement("ul");
  keyboardList.className = classes.list;

  const bindings = [
    { keys: "↑ W K", action: "Move up" },
    { keys: "↓ S J", action: "Move down" },
    { keys: "← A H", action: "Move left" },
    { keys: "→ D L", action: "Move right" },
    { keys: "X", action: "Toggle elimination mark" },
    { keys: "Q", action: "Commit guess" },
    { keys: "Shift + Direction", action: "Select a range" },
    { keys: "?", action: "Show this help" },
  ];

  for (const { keys, action } of bindings) {
    const item = document.createElement("li");
    item.className = classes.item;

    const keySpan = document.createElement("span");
    keySpan.className = classes.keys;
    keySpan.textContent = keys;
    item.append(keySpan);

    const actionSpan = document.createElement("span");
    actionSpan.className = classes.action;
    actionSpan.textContent = action;
    item.append(actionSpan);

    keyboardList.append(item);
  }

  keyboardSection.append(keyboardList);
  card.append(keyboardSection);

  // Footer: Actions row
  const actions = document.createElement("div");
  actions.className = classes.actions;

  if (config?.onReplayTutorial) {
    const replayButton = document.createElement("button");
    replayButton.className = "btn btn-secondary";
    replayButton.textContent = "Replay the tutorial";
    replayButton.addEventListener("click", () => {
      html.close();
      config.onReplayTutorial!();
    });
    actions.append(replayButton);
  }

  const closeButton = document.createElement("button");
  closeButton.className = "btn btn-primary";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => {
    html.close();
  });
  actions.append(closeButton);

  card.append(actions);
  html.append(card);

  // Dismiss on Escape and backdrop click (mirroring options.ts's dismissable pattern)
  html.addEventListener("cancel", () => {
    // Don't prevent default — let the dialog close naturally
  });

  html.addEventListener("click", (event) => {
    // Click on the dialog itself (not inside the card) is a backdrop click
    if (event.target === html) {
      html.close();
    }
  });

  return {
    html,

    open() {
      if (!html.open) {
        html.showModal();
      }
    },

    close() {
      html.close();
    },
  };
}
