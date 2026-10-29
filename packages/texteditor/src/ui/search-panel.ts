import { Facet, type EditorState } from "@codemirror/state";
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, selectMatches, setSearchQuery, searchPanelOpen } from "@codemirror/search";
import type { TextEditorSearchQuery, TextEditorSearchDisplay, TextEditorSearchState } from "../editor-adapter";
import { checkedText, record } from "../model/validation";

/** Shared by the panel, keyboard dispatcher, and imperative adapter. */
export const textEditorSearchPolicy = Facet.define<{
  search?: boolean; replace?: boolean; onChange?(state: TextEditorSearchState): void;
}, { search?: boolean; replace?: boolean; onChange?(state: TextEditorSearchState): void }>({ combine: values => Object.assign({}, ...values) });

export function searchAllowed(state: EditorState) { return state.facet(textEditorSearchPolicy).search !== false; }
export function replaceAllowed(state: EditorState) { return searchAllowed(state) && state.facet(textEditorSearchPolicy).replace !== false && !state.readOnly; }
function notifySearch(view: EditorView) {
  try { view.state.facet(textEditorSearchPolicy).onChange?.(getCodeEditorSearch(view)); } catch { /* Observers cannot cancel a panel action. */ }
}

export function createTextEditorSearchQuery(input: TextEditorSearchQuery, display: TextEditorSearchDisplay = {}): SearchQuery {
  const value = record(input, ["query", "replacement", "caseSensitive", "wholeWord", "regex"], "検索条件");
  record(display, ["open", "replace"], "検索表示");
  for (const flag of ["caseSensitive", "wholeWord", "regex"] as const)
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") throw new Error("検索オプションはbooleanで指定してください。");
  if ([display.open, display.replace].some(value => value !== undefined && typeof value !== "boolean")) throw new Error("検索表示はbooleanで指定してください。");
  return new SearchQuery({ search: checkedText(value.query, "検索文字列"), replace: value.replacement === undefined ? "" : checkedText(value.replacement, "置換文字列"),
    caseSensitive: input.caseSensitive, wholeWord: input.wholeWord, regexp: input.regex });
}

/** Uses the same query and panel as keyboard/UI search; false leaves the previous query intact. */
export function setCodeEditorSearch(view: EditorView, input: TextEditorSearchQuery, display: TextEditorSearchDisplay = {}): boolean {
  try {
    const query = createTextEditorSearchQuery(input, display);
    if (!searchAllowed(view.state) || input.query && !query.valid || display.replace && !replaceAllowed(view.state)) return false;
    view.dispatch({ effects: setSearchQuery.of(query) });
    if (display.open === false) { panels.get(view)?.showReplace(false, false); closeSearchPanel(view); }
    else if (display.replace) openCompactReplacePanel(view);
    else { openSearchPanel(view); if (display.replace === false) panels.get(view)?.showReplace(false); }
    return true;
  } catch { return false; }
}

export function getCodeEditorSearch(view: EditorView): TextEditorSearchState {
  const query = getSearchQuery(view.state);
  return Object.freeze({ query: query.search, replacement: query.replace, caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord, regex: query.regexp, open: searchPanelOpen(view.state), replace: panels.get(view)?.isReplaceOpen() ?? false, valid: query.valid });
}

type Match = { from: number; to: number };
type MatchSummary = { matches: Match[]; truncated: boolean };
type SearchFlags = Pick<SearchQuery, "caseSensitive" | "wholeWord" | "regexp">;
const panels = new WeakMap<EditorView, CompactSearchPanel>();
const MATCH_COUNT_LIMIT = 10_000;

/** Counting is bounded and runs only when the document or matching options change. */
export function summarizeSearchMatches(state: EditorState, query: SearchQuery): MatchSummary {
  const matches: Match[] = [];
  if (!query.valid) return { matches, truncated: false };
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (matches.length === MATCH_COUNT_LIMIT) return { matches, truncated: true };
    matches.push({ from: next.value.from, to: next.value.to });
  }
  return { matches, truncated: false };
}

export function searchMatchOrdinal(matches: readonly Match[], from: number, to: number): number {
  let low = 0, high = matches.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (matches[mid].from < from) low = mid + 1; else high = mid;
  }
  return matches[low]?.from === from && matches[low]?.to === to ? low + 1 : 0;
}

function sameMatchingQuery(a: SearchQuery, b: SearchQuery) {
  return a.search === b.search && a.caseSensitive === b.caseSensitive && a.regexp === b.regexp && a.wholeWord === b.wholeWord && a.literal === b.literal && a.test === b.test;
}

type IconName = "chevron" | "previous" | "next" | "close" | "replace" | "replaceAll";
const iconPaths: Record<IconName, readonly string[]> = {
  chevron: ["m9 5 7 7-7 7"], previous: ["m6 14 6-6 6 6"], next: ["m6 10 6 6 6-6"], close: ["m6 6 12 12", "M18 6 6 18"],
  replace: ["M3 5h10M3 9h7", "m13 7 4 4-4 4", "M5 15v4h14"],
  replaceAll: ["M3 4h10M3 8h7", "m13 6 4 4-4 4", "M4 14v4h13", "M8 21h13v-7"],
};

function icon(document: Document, name: IconName) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(key, value);
  for (const value of iconPaths[name]) { const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", value); svg.append(path); }
  return svg;
}

export class CompactSearchPanel implements Panel {
  readonly dom: HTMLDivElement;
  readonly top = true;
  readonly pos = 80;
  private query: SearchQuery;
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private toggle: HTMLButtonElement;
  private replaceRow: HTMLDivElement;
  private count: HTMLSpanElement;
  private error: HTMLDivElement;
  private previous: HTMLButtonElement;
  private next: HTMLButtonElement;
  private replaceOne: HTMLButtonElement;
  private replaceEvery: HTMLButtonElement;
  private options: Record<keyof SearchFlags, HTMLButtonElement>;
  private expanded = false;
  private summary: MatchSummary;

  constructor(private view: EditorView) {
    const document = view.dom.ownerDocument;
    this.query = getSearchQuery(view.state);
    this.summary = summarizeSearchMatches(view.state, this.query);
    const div = (className: string) => { const node = document.createElement("div"); node.className = className; return node; };
    const button = (label: string, name: IconName, className: string, action: () => void) => {
      const node = document.createElement("button"); node.type = "button"; node.className = className; node.title = label; node.setAttribute("aria-label", label); node.append(icon(document, name)); node.addEventListener("click", action); return node;
    };
    const input = (name: string, label: string) => {
      const node = document.createElement("input"); node.type = "text"; node.name = name; node.className = "lxte-search-input"; node.placeholder = label; node.setAttribute("aria-label", label); node.setAttribute("form", ""); node.autocomplete = "off"; node.spellcheck = false;
      node.addEventListener("input", event => { if (!(event as InputEvent).isComposing) this.commit(); });
      node.addEventListener("compositionend", () => this.commit());
      return node;
    };
    this.dom = div("cm-search lxte-search-panel"); this.dom.setAttribute("role", "search"); this.dom.setAttribute("aria-label", "文書内を検索");
    const row = div("lxte-search-row"), wrap = div("lxte-search-input-wrap"), optionGroup = div("lxte-search-options"), actions = div("lxte-search-actions");
    this.searchField = input("search", "検索"); this.searchField.setAttribute("main-field", "true");
    this.replaceField = input("replace", "置換");
    this.toggle = button("置換を表示", "chevron", "lxte-search-icon lxte-search-toggle", () => this.showReplace(!this.expanded));
    this.toggle.setAttribute("aria-expanded", "false");
    const option = (flag: keyof SearchFlags, label: string, text: string) => {
      const node = document.createElement("button"); node.type = "button"; node.className = `lxte-search-option lxte-search-option-${flag}`; node.textContent = text; node.title = label; node.setAttribute("aria-label", label); node.setAttribute("aria-pressed", "false");
      node.addEventListener("click", () => { this.commit({ [flag]: !this.query[flag] }); this.searchField.focus(); });
      optionGroup.append(node); return node;
    };
    this.options = { caseSensitive: option("caseSensitive", "大文字小文字を区別", "Aa"), wholeWord: option("wholeWord", "単語単位で検索", "ab"), regexp: option("regexp", "正規表現", ".*") };
    this.count = document.createElement("span"); this.count.className = "lxte-search-count"; this.count.setAttribute("aria-live", "polite"); this.count.setAttribute("aria-atomic", "true");
    this.previous = button("前の一致（Shift+Enter）", "previous", "lxte-search-icon", () => findPrevious(view));
    this.next = button("次の一致（Enter）", "next", "lxte-search-icon", () => findNext(view));
    const close = button("検索を閉じる（Escape）", "close", "lxte-search-icon", () => { closeSearchPanel(view); view.focus(); });
    actions.append(this.previous, this.next, close); wrap.append(this.searchField, optionGroup); row.append(this.toggle, wrap, this.count, actions);
    this.replaceRow = div("lxte-replace-row"); this.replaceRow.hidden = true;
    const spacer = div("lxte-search-spacer"), replaceWrap = div("lxte-replace-input-wrap"), replaceActions = div("lxte-replace-actions");
    spacer.setAttribute("aria-hidden", "true"); replaceWrap.append(this.replaceField);
    this.replaceOne = button("置換", "replace", "lxte-search-icon", () => this.replace(false));
    this.replaceEvery = button("すべて置換", "replaceAll", "lxte-search-icon", () => this.replace(true));
    replaceActions.append(this.replaceOne, this.replaceEvery); this.replaceRow.append(spacer, replaceWrap, replaceActions);
    this.error = div("lxte-search-error"); this.error.setAttribute("role", "status"); this.error.hidden = true;
    this.dom.append(row, this.replaceRow, this.error);
    this.dom.addEventListener("keydown", event => this.keydown(event));
    panels.set(view, this);
    this.renderQuery(); this.renderStatus();
  }

  private commit(flags: Partial<SearchFlags> = {}) {
    const query = new SearchQuery({ search: this.searchField.value, replace: this.replaceField.value, caseSensitive: this.query.caseSensitive, wholeWord: this.query.wholeWord, regexp: this.query.regexp, literal: this.query.literal, test: this.query.test, ...flags });
    if (!query.eq(this.query)) this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private replace(all: boolean) {
    if (!replaceAllowed(this.view.state)) return;
    this.commit();
    if (!this.query.valid || !this.summary.matches.length) return;
    (all ? replaceAll : replaceNext)(this.view);
  }

  isReplaceOpen() { return this.expanded; }

  showReplace(expanded = true, focus = true) {
    if (expanded && !replaceAllowed(this.view.state)) return false;
    this.expanded = expanded; this.renderStatus();
    if (focus) { if (expanded) this.replaceField.focus(); else this.searchField.focus(); }
    notifySearch(this.view);
    return true;
  }

  private keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && (event.target === this.searchField || event.target === this.replaceField || event.altKey)) {
      event.preventDefault(); event.stopPropagation(); this.commit();
      if (!this.query.valid || !this.summary.matches.length) return;
      if (event.altKey) { if (selectMatches(this.view)) this.view.focus(); }
      else if (event.target === this.replaceField) this.replace(event.shiftKey);
      else (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closeSearchPanel(this.view); this.view.focus();
    } else if (runScopeHandlers(this.view, event, "search-panel")) {
      event.preventDefault(); event.stopPropagation();
    }
  }

  private renderQuery() {
    if (this.searchField.value !== this.query.search) this.searchField.value = this.query.search;
    if (this.replaceField.value !== this.query.replace) this.replaceField.value = this.query.replace;
    for (const flag of Object.keys(this.options) as (keyof SearchFlags)[]) this.options[flag].setAttribute("aria-pressed", String(this.query[flag]));
  }

  private renderStatus() {
    const invalid = !!this.query.search && !this.query.valid, hasMatches = this.summary.matches.length > 0;
    const ordinal = searchMatchOrdinal(this.summary.matches, this.view.state.selection.main.from, this.view.state.selection.main.to);
    const total = `${this.summary.matches.length.toLocaleString()}${this.summary.truncated ? "+" : ""}`;
    this.count.textContent = !this.query.search || invalid ? "" : ordinal ? `${ordinal.toLocaleString()} / ${total}` : `${total}件`;
    this.count.title = this.summary.truncated ? "一致数の表示は10,000件までです。検索・置換は続けて使用できます。" : "";
    this.error.hidden = !invalid; this.error.textContent = invalid ? "正規表現が正しくありません" : "";
    this.searchField.setAttribute("aria-invalid", String(invalid));
    this.dom.dataset.empty = String(!!this.query.search && !invalid && !hasMatches);
    this.previous.disabled = this.next.disabled = !this.query.valid || !hasMatches;
    const readOnly = !replaceAllowed(this.view.state);
    const hidden = this.view.state.facet(textEditorSearchPolicy).replace === false;
    if (hidden) this.expanded = false;
    this.toggle.hidden = hidden;
    this.toggle.disabled = readOnly && !this.expanded; this.toggle.setAttribute("aria-expanded", String(this.expanded));
    this.toggle.title = this.expanded ? "置換を閉じる" : "置換を表示"; this.toggle.setAttribute("aria-label", this.toggle.title);
    this.replaceRow.hidden = !this.expanded;
    this.replaceField.disabled = readOnly;
    this.replaceOne.disabled = this.replaceEvery.disabled = readOnly || !this.query.valid || !hasMatches;
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state);
    if (update.docChanged || !sameMatchingQuery(query, this.query)) this.summary = summarizeSearchMatches(update.state, query);
    if (!query.eq(this.query)) { this.query = query; this.renderQuery(); }
    this.renderStatus();
  }

  mount() { this.searchField.focus(); this.searchField.select(); }
  destroy() { if (panels.get(this.view) === this) panels.delete(this.view); }
}

export const createCompactSearchPanel = (view: EditorView): Panel => new CompactSearchPanel(view);

export function openCompactReplacePanel(view: EditorView): boolean {
  if (!replaceAllowed(view.state)) return false;
  openSearchPanel(view);
  return panels.get(view)?.showReplace(true) ?? false;
}
