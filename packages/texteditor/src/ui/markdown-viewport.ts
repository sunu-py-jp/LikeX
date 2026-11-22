import { DOMSerializer, type Node as MarkdownNode } from "prosemirror-model";
import { TextSelection, type EditorState, type Selection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from "prosemirror-view";

/**
 * Renders only the part of a large rich document that is near the viewport.
 *
 * A unit is a top-level block or an item of a top-level list. Units that carry the mark
 * decoration are rendered normally; every other unit is an empty element of the same height.
 * The marked set is the measured window around the viewport plus the units at and next to the
 * selection, so the caret always sits in real content. Display state only: it never enters the
 * document, the selection or the change/history path.
 */
type Range = readonly [from: number, to: number];
type ListRange = { index: number; node: MarkdownNode; range: Range };
export type MarkdownViewportWindow = { top: Range; lists: readonly ListRange[] };
type Layout = { doc: MarkdownNode; starts: number[]; units: number };
type Metrics = { width: number; font: number; line: number };
type Unit = readonly [top: number, item: number | undefined];

const PLACEHOLDER = "lxte-rich-placeholder";
const MARK = { markdownViewport: true };
const BLOCKS = ["paragraph", "heading", "blockquote", "code_block", "horizontal_rule", "bullet_list", "ordered_list", "list_item"];
const NO_VIEWS: Record<string, NodeViewConstructor> = {};
const isList = (node: MarkdownNode) => node.type.name === "bullet_list" || node.type.name === "ordered_list";
const marked = (decoration: Decoration) => decoration.spec.markdownViewport === true;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

const layouts = new WeakMap<MarkdownNode, Layout>();
/** Start position of every top-level block, plus the end of the document. */
function layoutOf(doc: MarkdownNode): Layout {
  let layout = layouts.get(doc);
  if (!layout) {
    const starts = new Array<number>(doc.childCount + 1); let units = doc.childCount;
    doc.forEach((node, offset, index) => { starts[index] = offset; if (isList(node)) units += node.childCount; });
    starts[doc.childCount] = doc.content.size;
    layouts.set(doc, layout = { doc, starts, units });
  }
  return layout;
}
const itemStarts = new WeakMap<MarkdownNode, number[]>();
/** Offset of every item inside a list, plus the end of its content. */
function itemOffsets(list: MarkdownNode): number[] {
  let offsets = itemStarts.get(list);
  if (!offsets) {
    offsets = new Array<number>(list.childCount + 1);
    list.forEach((_item, offset, index) => { offsets![index] = offset; });
    offsets[list.childCount] = list.content.size; itemStarts.set(list, offsets);
  }
  return offsets;
}
function indexOf(sorted: readonly number[], value: number): number {
  let low = 0, high = sorted.length - 1;
  while (low < high) { const middle = (low + high + 1) >> 1; if (sorted[middle] <= value) low = middle; else high = middle - 1; }
  return low;
}
/** 0 for a top-level block, 1 for an item of a top-level list, -1 for nested content. */
function unitLevel(layout: Layout, position: number, node: MarkdownNode): number {
  const top = indexOf(layout.starts, position);
  if (layout.starts[top] === position) return top < layout.doc.childCount ? 0 : -1;
  if (node.type.name !== "list_item" || position < 0) return -1;
  const list = layout.doc.child(top);
  if (!isList(list)) return -1;
  const offsets = itemOffsets(list), offset = position - layout.starts[top] - 1, item = indexOf(offsets, offset);
  return offsets[item] === offset && item < list.childCount ? 1 : -1;
}

/** Large documents are windowed; the lower limits for staying windowed avoid switching back and forth while editing. */
export function markdownViewportActive(doc: MarkdownNode, active = false): boolean {
  const units = layoutOf(doc).units, size = doc.content.size;
  return active ? units >= 200 || size >= 100_000 : units >= 400 || size >= 200_000;
}

/** Height of a block that has not been laid out yet, from its text length and the page width. */
export function estimateMarkdownBlockHeight(node: MarkdownNode, width = 700, font = 16, line = font * 1.85): number {
  const name = node.type.name;
  if (name === "horizontal_rule") return font * 1.7 + 1;
  if (name === "code_block") {
    const text = node.textContent; let lines = 1;
    for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) lines++;
    return lines * font * 1.34 + 36 + font;
  }
  if (node.isTextblock) {
    const scale = name === "heading" ? [2.05, 1.5, 1.2][node.attrs.level - 1] ?? 1 : 1;
    // Full-width characters take about twice the room of Latin letters.
    const sample = node.textBetween(0, Math.min(node.content.size, 48)); let wide = 0;
    for (let index = 0; index < sample.length; index++) if (sample.charCodeAt(index) > 0x2e7f) wide++;
    const advance = font * scale * (sample.length ? .5 + .5 * wide / sample.length : .5);
    const lines = Math.max(1, Math.ceil(node.content.size * advance / Math.max(advance, width)));
    return name === "heading" ? lines * font * scale * 1.35 + font * scale * 1.25 : lines * line + font * .55;
  }
  let total = isList(node) ? font * .9 : name === "blockquote" ? font : 0;
  node.forEach(child => { total += estimateMarkdownBlockHeight(child, width - font * 1.55, font, line); });
  return total;
}

/** Children of a vertical stack that intersect `top`..`bottom`. Never empty: falls back to the nearest child. */
export function visibleRange(count: number, rect: (index: number) => { top: number; bottom: number }, top: number, bottom: number): Range {
  let low = 0, high = count;
  while (low < high) { const middle = (low + high) >> 1; if (rect(middle).bottom > top) high = middle; else low = middle + 1; }
  const from = clamp(low, 0, Math.max(0, count - 1));
  low = from; high = count;
  while (low < high) { const middle = (low + high) >> 1; if (rect(middle).top < bottom) low = middle + 1; else high = middle; }
  return [from, Math.max(from, low - 1)];
}

function listRange(view: MarkdownViewportWindow, index: number, node: MarkdownNode): Range | undefined {
  // Typing inside a list replaces its node; inserting a block above it shifts its index.
  return (view.lists.find(entry => entry.node === node) ?? view.lists.find(entry => entry.index === index))?.range;
}
function neighbor(doc: MarkdownNode, [top, item]: Unit, direction: 1 | -1): Unit | null {
  if (item !== undefined && item + direction >= 0 && item + direction < doc.child(top).childCount) return [top, item + direction];
  const next = top + direction;
  if (next < 0 || next >= doc.childCount) return null;
  const other = doc.child(next);
  return [next, isList(other) ? direction > 0 ? 0 : other.childCount - 1 : undefined];
}

/** Units to render: the window plus the unit at each selection end and the units right before and after it. */
export function markdownViewportUnits(doc: MarkdownNode, selection: Selection, view: MarkdownViewportWindow): Map<number, Set<number> | null> {
  const units = new Map<number, Set<number> | null>(), last = doc.childCount - 1;
  const add = ([top, item]: Unit) => {
    let items = units.get(top);
    if (items === undefined) units.set(top, items = isList(doc.child(top)) ? new Set() : null);
    if (item !== undefined) items?.add(item);
  };
  for (let top = Math.max(0, view.top[0]); top <= Math.min(last, view.top[1]); top++) {
    const node = doc.child(top), range = isList(node) ? listRange(view, top, node) : undefined;
    add([top, undefined]);
    if (range) for (let item = Math.max(0, range[0]); item <= Math.min(node.childCount - 1, range[1]); item++) add([top, item]);
  }
  for (const end of [selection.$anchor, selection.$head]) {
    const top = clamp(end.index(0), 0, last), node = doc.child(top);
    const item = end.depth ? clamp(end.index(1), 0, node.childCount - 1) : end.index(0) > last ? node.childCount - 1 : 0;
    const unit: Unit = [top, isList(node) ? item : undefined];
    add(unit);
    for (const direction of [-1, 1] as const) { const other = neighbor(doc, unit, direction); if (other) add(other); }
  }
  return units;
}

export type MarkdownViewport = ReturnType<typeof createMarkdownViewport>;

export function createMarkdownViewport(getScroller: () => HTMLElement | null) {
  let view: EditorView | null = null, active = false, printing = false, broken = false, destroyed = false;
  let current: MarkdownViewportWindow = { top: [0, 0], lists: [] };
  let cache: { doc: MarkdownNode; key: string; set: DecorationSet } | null = null;
  let heights = new WeakMap<MarkdownNode, number>(), metrics: Metrics = { width: 700, font: 16, line: 29.6 };
  let cancel: (() => void) | null = null, observer: ResizeObserver | null = null, detach = () => {};
  const heightOf = (node: MarkdownNode) => heights.get(node) ?? estimateMarkdownBlockHeight(node, metrics.width, metrics.font, metrics.line);
  const wanted = (doc: MarkdownNode) => !printing && !broken && markdownViewportActive(doc, active);
  const isPlaceholder = (element: Element | undefined) => !!element?.classList?.contains(PLACEHOLDER);

  const unitView: NodeViewConstructor = (node, editor, getPos, decorations) => {
    const level = unitLevel(layoutOf(editor.state.doc), getPos() ?? -1, node), owner = editor.dom.ownerDocument;
    let shown = node;
    if (level >= 0 && !decorations.some(marked)) {
      const dom = owner.createElement(level ? "li" : "div");
      dom.className = PLACEHOLDER; dom.setAttribute("aria-hidden", "true"); dom.style.height = `${heightOf(node)}px`;
      return {
        dom, ignoreMutation: () => true,
        update(next, outer) {
          if (outer.some(marked)) return false;
          if (next !== shown) { shown = next; dom.style.height = `${heightOf(next)}px`; }
          return true;
        },
      } satisfies NodeView;
    }
    // The same elements ProseMirror would create; only the update rule differs.
    const { dom, contentDOM } = DOMSerializer.renderSpec(owner, node.type.spec.toDOM!(node));
    return { dom, contentDOM, update(next, outer) {
      if (level >= 0 && !outer.some(marked) || !next.sameMarkup(shown)) return false;
      shown = next; return true;
    } } satisfies NodeView;
  };
  const views: Record<string, NodeViewConstructor> = Object.fromEntries(BLOCKS.map(name => [name, unitView]));

  /** Before anything is laid out: fill about three screens from the top using estimated heights. */
  function initialWindow(doc: MarkdownNode): MarkdownViewportWindow {
    let budget = 3 * (getScroller()?.clientHeight || 800), top = 0;
    const lists: ListRange[] = [];
    for (; top < doc.childCount && budget > 0; top++) {
      const node = doc.child(top);
      if (!isList(node)) { budget -= heightOf(node); continue; }
      let item = 0;
      for (; item < node.childCount && budget > 0; item++) budget -= heightOf(node.child(item));
      lists.push({ index: top, node, range: [0, Math.max(0, item - 1)] });
    }
    return { top: [0, Math.max(0, top - 1)], lists };
  }

  function measure(scroller: HTMLElement, root: HTMLElement, overscan: number): MarkdownViewportWindow | null {
    const doc = view!.state.doc, box = scroller.getBoundingClientRect();
    if (!(box.width || box.height)) return null; // Not displayed: keep what is rendered.
    const screen = root.ownerDocument?.defaultView?.innerHeight || box.bottom;
    const top = Math.max(box.top, 0) - overscan, bottom = Math.min(box.bottom, screen) + overscan;
    const rects = (elements: HTMLCollection) => (index: number) => elements[index].getBoundingClientRect();
    const range = visibleRange(doc.childCount, rects(root.children), top, bottom), lists: ListRange[] = [];
    for (let index = range[0]; index <= range[1]; index++) {
      const node = doc.child(index), element = root.children[index];
      if (isList(node) && !isPlaceholder(element) && element.children.length === node.childCount)
        lists.push({ index, node, range: visibleRange(node.childCount, rects(element.children), top, bottom) });
    }
    return { top: range, lists };
  }
  function covers(next: MarkdownViewportWindow): boolean {
    if (next.top[0] < current.top[0] || next.top[1] > current.top[1]) return false;
    return next.lists.every(entry => {
      const range = listRange(current, entry.index, entry.node);
      return !!range && entry.range[0] >= range[0] && entry.range[1] <= range[1];
    });
  }
  /** Keep the laid-out height of rendered units, so that they keep their size as placeholders. */
  function remember(root: HTMLElement, all = false) {
    const doc = view!.state.doc;
    if (root.children.length !== doc.childCount) return;
    const record = (elements: HTMLCollection, parent: MarkdownNode, [from, to]: Range) => {
      for (let index = Math.max(0, from); index <= Math.min(to, parent.childCount - 1); index++) {
        const element = elements[index];
        if (isPlaceholder(element)) continue;
        const box = element.getBoundingClientRect(), next = elements[index + 1];
        heights.set(parent.child(index), Math.max(0, (next ? next.getBoundingClientRect().top : box.bottom) - box.top));
      }
    };
    const items = (index: number, range: Range) => {
      const node = doc.child(index), element = root.children[index];
      if (isList(node) && !isPlaceholder(element) && element.children.length === node.childCount) record(element.children, node, range);
    };
    record(root.children, doc, all ? [0, doc.childCount - 1] : current.top);
    if (all) doc.forEach((node, _offset, index) => items(index, [0, node.childCount - 1]));
    else for (const entry of current.lists) if (entry.index < doc.childCount) items(entry.index, entry.range);
  }
  function readMetrics(root: HTMLElement) {
    const style = root.ownerDocument?.defaultView?.getComputedStyle?.(root), font = parseFloat(style?.fontSize ?? "") || 16;
    metrics = { width: root.clientWidth || 700, font, line: parseFloat(style?.lineHeight ?? "") || font * 1.85 };
  }

  /**
   * The caret on the page can be ahead of the editor state for a moment: key presses can arrive
   * faster than selection events. Rebuilding the page then would put the older selection back,
   * so the page's selection is taken over first, as the editor does when the event arrives.
   */
  function adoptSelection() {
    const root = view!.dom as HTMLElement, owner = root.ownerDocument, found = owner?.getSelection?.(), state = view!.state;
    if (!(state.selection instanceof TextSelection) || owner.activeElement !== root || !found?.focusNode || !found.anchorNode) return;
    if (!root.contains(found.focusNode) || !root.contains(found.anchorNode)) return;
    try {
      const head = view!.posAtDOM(found.focusNode, found.focusOffset, 1);
      const anchor = found.isCollapsed ? head : view!.posAtDOM(found.anchorNode, found.anchorOffset, 1);
      const next = TextSelection.between(state.doc.resolve(anchor), state.doc.resolve(head));
      if (!next.eq(state.selection)) view!.dispatch(state.tr.setSelection(next));
    } catch { /* Not a position inside the document; the editor reads the selection on its own. */ }
  }
  function sync() {
    cancel = null;
    const scroller = getScroller();
    if (!view || destroyed || !active || !scroller || typeof scroller.getBoundingClientRect !== "function") return;
    if (view.composing) return; // Rebuilding around an IME composition can drop it; compositionend retries.
    const root = view.dom as HTMLElement;
    if (!root.children || root.children.length !== view.state.doc.childCount) {
      // The page no longer maps one element to one block. Showing everything is the safe choice.
      broken = true; switchTo(false, view.state); return;
    }
    const overscan = Math.max(600, scroller.clientHeight || 0);
    for (let pass = 0; pass < 4; pass++) {
      const needed = measure(scroller, root, overscan / 2);
      if (!needed || covers(needed)) return;
      const next = measure(scroller, root, overscan);
      if (!next) return;
      remember(root); adoptSelection();
      current = next; view.setProps({});
    }
  }
  function schedule() {
    if (cancel || destroyed || !active) return;
    if (typeof requestAnimationFrame === "function") { const id = requestAnimationFrame(sync); cancel = () => cancelAnimationFrame(id); }
    else { const id = setTimeout(sync, 16); cancel = () => clearTimeout(id); }
  }
  function switchTo(next: boolean, state: EditorState) {
    if (!view) return;
    const root = view.dom as HTMLElement;
    if (next) { if (root.children) { readMetrics(root); remember(root, true); } current = initialWindow(state.doc); }
    active = next; cache = null;
    view.setProps({ state, nodeViews: next ? views : NO_VIEWS });
    if (next) sync();
  }

  return {
    /** Node views for the first render. Decides whether this document starts windowed. */
    nodeViews(doc: MarkdownNode): Record<string, NodeViewConstructor> {
      active = wanted(doc);
      if (active) current = initialWindow(doc);
      return active ? views : NO_VIEWS;
    },
    /** `extra` are the editor's own decorations; they are returned unchanged when the document is small. */
    decorations(state: EditorState, extra: readonly Decoration[]): DecorationSet {
      if (!active) return extra.length ? DecorationSet.create(state.doc, extra.slice()) : DecorationSet.empty;
      const units = markdownViewportUnits(state.doc, state.selection, current);
      let key = extra.map(decoration => `${decoration.from}:${decoration.to}`).join();
      for (const [top, items] of units) key += `|${top}${items ? `:${[...items].join()}` : ""}`;
      if (cache?.doc === state.doc && cache.key === key) return cache.set;
      const { starts } = layoutOf(state.doc), decorations = extra.slice();
      for (const [top, items] of units) {
        decorations.push(Decoration.node(starts[top], starts[top + 1], {}, MARK));
        if (!items) continue;
        const offsets = itemOffsets(state.doc.child(top)), base = starts[top] + 1;
        for (const item of items) decorations.push(Decoration.node(base + offsets[item], base + offsets[item + 1], {}, MARK));
      }
      cache = { doc: state.doc, key, set: DecorationSet.create(state.doc, decorations) };
      return cache.set;
    },
    attach(editor: EditorView) {
      view = editor;
      const root = editor.dom as HTMLElement, owner = root.ownerDocument?.defaultView, scroller = getScroller();
      const onScroll = (event: Event) => {
        const target = event.target as Node | null, box = getScroller();
        if (box && target && (target === box || target === root.ownerDocument || typeof target.contains === "function" && target.contains(box))) sync();
      };
      const onResize = () => {
        if (Math.abs((root.clientWidth || 0) - metrics.width) > 1) { heights = new WeakMap(); readMetrics(root); }
        sync();
      };
      const print = (value: boolean) => () => { printing = value; if (view && wanted(view.state.doc) !== active) switchTo(!active, view.state); };
      const before = print(true), after = print(false);
      owner?.addEventListener("scroll", onScroll, { capture: true, passive: true });
      owner?.addEventListener("resize", onResize);
      owner?.addEventListener("beforeprint", before);
      owner?.addEventListener("afterprint", after);
      root.addEventListener?.("compositionend", schedule);
      if (scroller && typeof ResizeObserver === "function") { observer = new ResizeObserver(onResize); observer.observe(scroller); }
      detach = () => {
        owner?.removeEventListener("scroll", onScroll, { capture: true });
        owner?.removeEventListener("resize", onResize);
        owner?.removeEventListener("beforeprint", before);
        owner?.removeEventListener("afterprint", after);
        root.removeEventListener?.("compositionend", schedule);
      };
      if (active && root.children) { readMetrics(root); sync(); }
    },
    /** Use in place of `view.updateState`: switches windowing on or off with the document it is about to show. */
    updateState(state: EditorState) {
      if (!view) return;
      const next = wanted(state.doc);
      if (next !== active) switchTo(next, state);
      else { view.updateState(state); schedule(); }
    },
    /**
     * Call when a key is about to move the caret. The browser moves it through the page, and it
     * skips to the far end of the document if the next line is not rendered. So the page is
     * brought up to date first: around the caret as the page has it, and around the screen as it
     * is scrolled now. For page-wise keys an off-screen caret is scrolled into view, as the key
     * itself would do.
     */
    prepareNavigation(pagewise: boolean) {
      const scroller = getScroller();
      if (!view || !active || destroyed || view.composing || !scroller || typeof scroller.getBoundingClientRect !== "function") return;
      adoptSelection();
      if (pagewise) {
        const caret = view.coordsAtPos(view.state.selection.head), box = scroller.getBoundingClientRect();
        if (caret.bottom < box.top || caret.top > box.bottom) scroller.scrollTop += caret.top - box.top - box.height / 2;
      }
      sync();
    },
    isActive: () => active,
    destroy() {
      destroyed = true; detach(); observer?.disconnect(); observer = null; view = null;
      cancel?.(); cancel = null;
    },
  };
}
