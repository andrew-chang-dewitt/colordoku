import classes from "./help.module.css";

export interface HelpOverlay {
  html: HTMLDialogElement;
  open: () => void;
  close: () => void;
}

export function newHelpOverlay(): HelpOverlay {
  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const card = document.createElement("div");
  card.className = classes.card;

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  heading.textContent = "Keyboard controls";
  card.append(heading);

  const list = document.createElement("ul");
  list.className = classes.list;

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

    list.append(item);
  }

  card.append(list);
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
