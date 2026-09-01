/**
 * The game history view: browse past attempts recorded by
 * src/persistence/history.ts's getHistory(), with filtering/sorting, and a
 * per-entry action to replay or share that entry's board.
 *
 * A <dialog> bottom-sheet drawer, matching options.ts's house pattern (same
 * backdrop-click-to-close, Escape-to-close, and translate/starting-style
 * open animation) — a scrollable list is exactly the shape that pattern
 * already suits, and reusing it keeps every drawer/modal in the app looking
 * and behaving the same way rather than inventing a second style.
 *
 * NOT wired into a real trigger yet: the README TODO's `#history` item calls
 * for this to live behind a user-profile menu, but that menu (its dropdown,
 * not just its placeholder button) doesn't exist yet — see main.ts, where
 * this is opened by a standalone temporary button instead. Swapping the
 * trigger later is a one-line change (call `.open()` from wherever the menu
 * item ends up) since nothing about this module depends on how it's opened.
 */

import classes from "./historyview.module.css";
import type { HistoryEntry, HistoryStatus } from "../persistence/history";
import { getHistory } from "../persistence/history";
import type { Difficulty } from "../options/options";
import { formatElapsed } from "../timer/timer";
import { buildShareUrl, newShareButton } from "../share/share";
import { TUTORIAL_SEED } from "../persistence/tutorial";
import {
  currentWeekBounds,
  weeklyScoreTotal,
  allTimeScoreTotal,
  cumulativeScoreThroughEntry,
} from "../persistence/weeklyScore";

export type StatusFilter = HistoryStatus | "all";
export type SizeFilter = number | "all";
export type SortKey =
  | "newest"
  | "oldest"
  | "longest"
  | "shortest"
  | "largest"
  | "smallest"
  | "score";

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest played" },
  { value: "shortest", label: "Shortest played" },
  { value: "largest", label: "Largest board" },
  { value: "smallest", label: "Smallest board" },
  { value: "score", label: "Highest score" },
];

const STATUS_LABELS: Record<HistoryStatus, string> = {
  playing: "Playing",
  won: "Won",
  lost: "Lost",
  abandoned: "Abandoned",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/**
 * CSS module keys mirror exactly what's authored in historyview.module.css
 * (camelCase, no kebab-case transform — matches this codebase's convention
 * elsewhere, e.g. cell.module.css's classes.found/.error), so a per-status
 * badge class is looked up through this map rather than built as a dynamic
 * `status-${status}` string, which wouldn't match any real exported key.
 */
const STATUS_CLASSES: Record<HistoryStatus, string> = {
  playing: "statusPlaying",
  won: "statusWon",
  lost: "statusLost",
  abandoned: "statusAbandoned",
};

/** Pure, DOM-free: keeps entries whose status/size match the given filter ("all" matches everything for that dimension). */
export function filterEntries(
  entries: HistoryEntry[],
  filter: { status: StatusFilter; size: SizeFilter },
): HistoryEntry[] {
  return entries.filter(
    (e) =>
      (filter.status === "all" || e.status === filter.status) &&
      (filter.size === "all" || e.size === filter.size),
  );
}

/** Pure, DOM-free: returns a new array (never mutates `entries`) sorted per `key`. */
export function sortEntries(entries: HistoryEntry[], key: SortKey): HistoryEntry[] {
  const sorted = entries.slice();
  switch (key) {
    case "newest":
      return sorted.sort((a, b) => b.startedAt - a.startedAt);
    case "oldest":
      return sorted.sort((a, b) => a.startedAt - b.startedAt);
    case "longest":
      return sorted.sort((a, b) => b.elapsedMs - a.elapsedMs);
    case "shortest":
      return sorted.sort((a, b) => a.elapsedMs - b.elapsedMs);
    case "largest":
      return sorted.sort((a, b) => b.size - a.size);
    case "smallest":
      return sorted.sort((a, b) => a.size - b.size);
    case "score":
      // Unscored entries (score: null — still playing, or migrated from
      // before scoring existed) sort to the bottom under "highest score"
      // rather than being treated as a 0, which would misleadingly rank
      // them alongside (or above) a real low score.
      return sorted.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  }
}

/** Distinct board sizes present in `entries`, ascending — for populating the size filter's options. */
export function sizesIn(entries: HistoryEntry[]): number[] {
  return Array.from(new Set(entries.map((e) => e.size))).sort((a, b) => a - b);
}

export interface HistoryViewConfig {
  /**
   * Starts a fresh attempt on the given (size, seed) — the same
   * abandon-then-navigate function options.ts's "Start over" button uses
   * (see startOver() there). Reused as-is rather than wrapped: it already
   * does exactly what a history entry's "Play again" needs regardless of
   * whether the target board happens to be the one currently on screen or a
   * completely different one from history — closeOutInProgress() reads
   * whatever's actually in progress right now, not anything tied to a
   * specific entry, so the same call is correct in both cases.
   *
   * Deliberately NOT confirm-gated here, unlike the live board's "Start
   * over" button: the README TODO tracks "generalize start over
   * confirmation dialog for any time user tries to start a new game while a
   * current game is already active" as its own separate, not-yet-built
   * item — bolting an ad hoc confirmation onto just this one entry point
   * would preempt that generalization rather than composing with it.
   *
   * Called with the entry's own `difficulty`, so replaying a past attempt
   * from history keeps whatever difficulty it was originally played under
   * (which also determines how the new attempt's own score is computed —
   * see persistence/score.ts) rather than silently defaulting to something
   * else.
   */
  onPlayAgain: (size: number, seed: number, difficulty: Difficulty) => void;
  /** Injectable for tests; defaults to the real persistence/history.ts getHistory. */
  getEntries?: () => HistoryEntry[];
}

export interface HistoryView {
  html: HTMLDialogElement;
  /**
   * With no argument, opens showing whatever filters/sort are already
   * active. With `focusEntryId`, first resets both filters to "all" (so an
   * active filter can't hide the target entry — that would defeat the whole
   * point of "bring it into view"), keeping the current sort as-is, then
   * scrolls to and briefly highlights that entry's row. Used by
   * scoreview.ts's chart tooltip to jump straight to a specific game.
   */
  open: (focusEntryId?: string) => void;
  close: () => void;
}

export function newHistoryView({
  onPlayAgain,
  getEntries = getHistory,
}: HistoryViewConfig): HistoryView {
  let statusFilter: StatusFilter = "all";
  let sizeFilter: SizeFilter = "all";
  let sortKey: SortKey = "newest";

  const html = document.createElement("dialog");
  html.className = classes.drawer;

  const panel = document.createElement("div");
  panel.className = classes.panel;
  html.append(panel);

  const header = document.createElement("div");
  header.className = classes.header;
  panel.append(header);

  const heading = document.createElement("h2");
  heading.className = classes.heading;
  heading.textContent = "Game history";
  header.append(heading);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = `btn btn-secondary ${classes.close}`;
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => html.close());
  header.append(closeButton);

  const summary = document.createElement("div");
  summary.className = classes.summary;
  panel.append(summary);

  const controls = document.createElement("div");
  controls.className = classes.controls;
  panel.append(controls);

  function labeledSelect(labelText: string): { field: HTMLDivElement; select: HTMLSelectElement } {
    const field = document.createElement("div");
    field.className = classes.field;

    const label = document.createElement("label");
    label.textContent = labelText;
    field.append(label);

    const select = document.createElement("select");
    select.className = classes.select;
    label.append(select);

    return { field, select };
  }

  const statusControl = labeledSelect("Status");
  const statusAllOption = document.createElement("option");
  statusAllOption.value = "all";
  statusAllOption.textContent = "All statuses";
  statusControl.select.append(statusAllOption);
  for (const status of Object.keys(STATUS_LABELS) as HistoryStatus[]) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = STATUS_LABELS[status];
    statusControl.select.append(option);
  }
  controls.append(statusControl.field);

  const sizeControl = labeledSelect("Board size");
  controls.append(sizeControl.field);

  const sortControl = labeledSelect("Sort by");
  for (const { value, label } of SORT_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sortControl.select.append(option);
  }
  controls.append(sortControl.field);

  const list = document.createElement("ul");
  list.className = classes.list;
  panel.append(list);

  const emptyState = document.createElement("p");
  emptyState.className = classes.emptyState;
  panel.append(emptyState);

  function renderEntry(entry: HistoryEntry, allEntries: HistoryEntry[]): HTMLLIElement {
    const item = document.createElement("li");
    item.className = classes.entry;
    item.dataset.entryId = entry.id;

    const main = document.createElement("div");
    main.className = classes.entryMain;

    const size = document.createElement("span");
    size.className = classes.entrySize;
    size.textContent = `${entry.size}×${entry.size}`;
    main.append(size);

    const isTutorialEntry = entry.seed === TUTORIAL_SEED;

    const status = document.createElement("span");
    status.className = `${classes.entryStatus} ${classes[STATUS_CLASSES[entry.status]]}`;
    status.textContent = isTutorialEntry ? "Tutorial" : STATUS_LABELS[entry.status];
    main.append(status);

    if (!isTutorialEntry) {
      const difficulty = document.createElement("span");
      difficulty.className = classes.entryDifficulty;
      difficulty.textContent = DIFFICULTY_LABELS[entry.difficulty];
      main.append(difficulty);

      const attempt = document.createElement("span");
      attempt.className = classes.entryAttempt;
      attempt.textContent = `Attempt ${entry.attempt}`;
      main.append(attempt);
    }

    // "—" for a null score: still in progress, or an entry migrated from
    // before scoring existed (see history.ts's HistoryEntry.score doc
    // comment) — either way there's genuinely no number to show yet, not a
    // score of zero.
    const score = document.createElement("span");
    score.className = classes.entryScore;
    score.textContent = entry.score === null ? "Score: —" : `Score: ${entry.score}`;
    main.append(score);

    const weekTotal = document.createElement("span");
    weekTotal.className = classes.entryWeekTotal;
    weekTotal.textContent = `Week total: ${cumulativeScoreThroughEntry(allEntries, entry)}`;
    main.append(weekTotal);

    item.append(main);

    const meta = document.createElement("div");
    meta.className = classes.entryMeta;

    const elapsed = document.createElement("span");
    elapsed.textContent = formatElapsed(entry.elapsedMs);
    meta.append(elapsed);

    const date = document.createElement("span");
    date.textContent = new Date(entry.startedAt).toLocaleString();
    meta.append(date);

    item.append(meta);

    const actions = document.createElement("div");
    actions.className = classes.entryActions;

    // Don't offer "Play again" for tutorial entries (replaying ?board-id=<TUTORIAL_SEED> would generate
    // an unrelated real board rather than the hand-built practice one)
    if (!isTutorialEntry) {
      const playAgain = document.createElement("button");
      playAgain.type = "button";
      playAgain.className = "btn btn-secondary";
      playAgain.textContent = "Play again";
      playAgain.addEventListener("click", () => onPlayAgain(entry.size, entry.seed, entry.difficulty));
      actions.append(playAgain);
    }

    const share = newShareButton({
      getUrl: () => buildShareUrl(entry.size, entry.seed, location.origin, location.pathname, entry.difficulty),
    });
    actions.append(share.html);

    item.append(actions);

    return item;
  }

  /** Re-populates the size filter's options from whatever entries currently exist, preserving the current selection if it's still valid. */
  function refreshSizeOptions(entries: HistoryEntry[]): void {
    const previous = sizeFilter;
    sizeControl.select.replaceChildren();

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All sizes";
    sizeControl.select.append(allOption);

    for (const size of sizesIn(entries)) {
      const option = document.createElement("option");
      option.value = String(size);
      option.textContent = `${size}×${size}`;
      sizeControl.select.append(option);
    }

    const stillValid = previous === "all" || sizesIn(entries).includes(previous);
    sizeFilter = stillValid ? previous : "all";
    sizeControl.select.value = String(sizeFilter);
  }

  function render(): void {
    const all = getEntries();
    refreshSizeOptions(all);

    // Update summary line with unfiltered totals
    const weekBounds = currentWeekBounds();
    const weeklyTotal = weeklyScoreTotal(all, weekBounds);
    const allTimeTotal = allTimeScoreTotal(all);
    summary.textContent = `This week: ${weeklyTotal} · All-time: ${allTimeTotal}`;

    const filtered = filterEntries(all, { status: statusFilter, size: sizeFilter });
    const sorted = sortEntries(filtered, sortKey);

    list.replaceChildren();
    for (const entry of sorted) list.append(renderEntry(entry, all));

    const noneAtAll = all.length === 0;
    list.hidden = sorted.length === 0;
    emptyState.hidden = sorted.length > 0;
    emptyState.textContent = noneAtAll
      ? "No games played yet."
      : "No games match these filters.";
  }

  statusControl.select.addEventListener("change", () => {
    statusFilter = statusControl.select.value as StatusFilter;
    render();
  });

  sizeControl.select.addEventListener("change", () => {
    const value = sizeControl.select.value;
    sizeFilter = value === "all" ? "all" : Number(value);
    render();
  });

  sortControl.select.addEventListener("change", () => {
    sortKey = sortControl.select.value as SortKey;
    render();
  });

  html.addEventListener("cancel", (event) => {
    // Unlike gameover.ts's modal, this is a freely dismissable view, not a
    // forced choice — Escape is allowed to close it.
    void event;
  });

  html.addEventListener("click", (event) => {
    // Same "click landed on the dialog itself, not the panel covering it,
    // so it came from the backdrop" trick options.ts uses.
    if (event.target === html) html.close();
  });

  return {
    html,

    open(focusEntryId?: string) {
      if (focusEntryId !== undefined) {
        statusFilter = "all";
        sizeFilter = "all";
        statusControl.select.value = "all";
        sizeControl.select.value = "all";
      }

      render();
      if (!html.open) {
        html.showModal();
        closeButton.focus();
      }

      if (focusEntryId !== undefined) {
        const target = list.querySelector<HTMLLIElement>(
          `li[data-entry-id="${focusEntryId}"]`,
        );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add(classes.entryHighlight);
          setTimeout(() => target.classList.remove(classes.entryHighlight), 1800);
        }
      }
    },

    close() {
      html.close();
    },
  };
}
