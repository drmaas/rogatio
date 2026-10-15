import type { ChromeApi } from "./chrome.js";
import {
  type MatchHistoryEntry,
  subscribeMatchHistory,
} from "./match-history.js";
import { subscribeMatchLoggingEnabled } from "./match-logging-enabled.js";

export interface MatchHistoryPanelOptions {
  readonly loggingEnabled: boolean;
  readonly entries: readonly MatchHistoryEntry[];
  readonly onClear: () => void;
}

function metaLine(entry: MatchHistoryEntry): string {
  const parts = [
    entry.ruleId,
    entry.name,
    entry.kind,
    entry.method,
    entry.resourceType,
  ].filter((part) => part.length > 0);
  if (Number.isFinite(entry.at)) parts.push(new Date(entry.at).toISOString());
  return parts.join(" | ");
}

function renderRow(entry: MatchHistoryEntry): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "rogatio-match-history-row";
  item.dataset.matchHistoryEntry = "true";

  const url = document.createElement("p");
  url.className = "rogatio-match-history-url";
  url.dataset.matchHistoryUrl = "true";
  url.textContent = entry.url.length > 0 ? entry.url : "(no url)";
  item.append(url);

  const meta = document.createElement("p");
  meta.className = "rogatio-match-history-meta";
  meta.textContent = metaLine(entry);
  item.append(meta);

  if (entry.action.length > 0) {
    const action = document.createElement("p");
    action.className = "rogatio-match-history-action";
    action.dataset.matchHistoryAction = "true";
    action.textContent = entry.action;
    item.append(action);
  }

  if (entry.initiator.length > 0) {
    const initiator = document.createElement("p");
    initiator.className = "rogatio-match-history-meta";
    initiator.dataset.matchHistoryInitiator = "true";
    initiator.textContent = entry.initiator;
    item.append(initiator);
  }

  return item;
}

/** Management-page match feed. Newest row first. Text only. */
export function createMatchHistoryPanel(
  options: MatchHistoryPanelOptions,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "rogatio-match-history";
  section.dataset.matchHistoryRoot = "true";
  section.setAttribute("aria-labelledby", "rogatio-match-history-title");

  const title = document.createElement("h2");
  title.id = "rogatio-match-history-title";
  title.textContent = "Match history";

  const subtitle = document.createElement("p");
  subtitle.className = "rogatio-overview-subtitle";
  subtitle.textContent =
    "Recent Rogatio rule matches from this browser session. Only matched rules are listed. Up to 100 rows are kept; older rows drop off. History clears when Match logging is turned off, when you choose Clear, or when this browser session ends. It is not saved in the project file. Packed or store installs do not report matches.";

  const actions = document.createElement("div");
  actions.className = "rogatio-match-history-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.dataset.command = "clear-match-history";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    options.onClear();
  });
  actions.append(clear);
  section.append(title, subtitle, actions);

  if (!options.loggingEnabled) {
    const empty = document.createElement("p");
    empty.className = "rogatio-match-history-empty";
    empty.dataset.matchHistoryEmpty = "off";
    empty.textContent =
      "Match logging is off. Matches are not recorded, and history is cleared when logging is turned off.";
    section.append(empty);
    return section;
  }

  const count = document.createElement("p");
  count.className = "rogatio-match-history-count";
  count.dataset.matchHistoryCount = "true";
  count.textContent =
    options.entries.length === 1
      ? "1 match"
      : `${options.entries.length} matches`;
  section.append(count);

  if (options.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rogatio-match-history-empty";
    empty.dataset.matchHistoryEmpty = "none";
    empty.textContent =
      "No matches yet. A row appears when an installed Rogatio rule matches a request.";
    section.append(empty);
    return section;
  }

  const list = document.createElement("ol");
  list.className = "rogatio-match-history-list";
  list.dataset.matchHistoryFeed = "true";
  const newestFirst = [...options.entries].reverse();
  for (const entry of newestFirst) list.append(renderRow(entry));
  section.append(list);
  return section;
}

export interface MatchHistoryFeedBinding {
  readonly api: ChromeApi;
  getHost(): HTMLElement | null;
  getLoggingEnabled(): boolean;
  setLoggingEnabled(enabled: boolean): void;
  getEntries(): readonly MatchHistoryEntry[];
  setEntries(entries: readonly MatchHistoryEntry[]): void;
  onClear(): void;
}

function repaint(binding: MatchHistoryFeedBinding): void {
  const host = binding.getHost();
  if (host === null) return;
  host.replaceWith(
    createMatchHistoryPanel({
      loggingEnabled: binding.getLoggingEnabled(),
      entries: binding.getEntries(),
      onClear: () => {
        binding.onClear();
      },
    }),
  );
}

/** Replace the open feed when session history or the toggle changes. */
export function bindMatchHistoryFeed(
  binding: MatchHistoryFeedBinding,
): () => void {
  const unsubHistory = subscribeMatchHistory(binding.api, (entries) => {
    binding.setEntries(entries);
    repaint(binding);
  });
  const unsubLogging = subscribeMatchLoggingEnabled(binding.api, (enabled) => {
    binding.setLoggingEnabled(enabled);
    repaint(binding);
  });
  return () => {
    unsubHistory();
    unsubLogging();
  };
}
