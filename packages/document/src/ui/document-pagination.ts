import type { EditorView, NodeViewConstructor } from "prosemirror-view";
import type { DocumentPage } from "../model/types";

const millimetres = 96 / 25.4;
const gap = 24;
const measuringHeight = 1;
const boundarySelector = "[data-lxd-page-boundary]";
type Paper = { top: number; height: number };

/** Offsets describe natural flow with the display-only spacers collapsed. */
export function calculateDocumentPagination(offsets: readonly number[], contentHeight: number, pageHeight: number, marginTop: number, marginBottom: number) {
  const papers: Paper[] = [], spacers: number[] = [];
  let top = 0, added = 0;
  for (const offset of offsets) {
    const boundary = offset + added;
    const height = Math.max(pageHeight, boundary - top + marginBottom);
    const spacer = Math.max(0, top + height + gap + marginTop - boundary);
    papers.push({ top, height }); spacers.push(spacer);
    top += height + gap; added += spacer;
  }
  papers.push({ top, height: Math.max(pageHeight, contentHeight + added - top) });
  return { papers, spacers, height: top + papers[papers.length - 1].height };
}

/** Leaf views keep pagination DOM out of the saved model and ProseMirror transactions. */
export const createPageBreakNodeView: NodeViewConstructor = (initial, view) => {
  const rendered = initial.type.name === "rendered_page_break";
  const dom = view.dom.ownerDocument.createElement(rendered ? "span" : "div");
  dom.className = "lxd-page-boundary";
  dom.setAttribute("data-lxd-page-boundary", rendered ? "rendered" : "explicit");
  dom.setAttribute(rendered ? "data-rendered-page-break" : "data-page-break", "true");
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("role", "separator");
  const label = rendered ? "保存時点のページ境界" : "改ページ";
  dom.setAttribute("aria-label", label); dom.setAttribute("data-lxd-page-boundary-label", label);
  dom.title = rendered ? "Wordの保存時点のページ境界（自動再計算されません）" : "改ページ";
  const update = (node: typeof initial) => {
    if (node.type !== initial.type) return false;
    if (node.attrs.id) dom.setAttribute("data-document-id", String(node.attrs.id));
    else dom.removeAttribute("data-document-id");
    return true;
  };
  update(initial);
  return { dom, update, ignoreMutation: mutation => mutation.type !== "selection" };
};

/**
 * One editor, with display-only paper backgrounds and boundary spacers. Table
 * cells flow in parallel, so their markers remain visible but do not cut paper.
 * Oversized stored sections grow a paper instead of clipping or repaginating.
 */
export function createDocumentPagination(view: EditorView, layer: HTMLElement, getPage: () => DocumentPage, afterLayout?: () => void) {
  const root = view.dom, doc = root.ownerDocument, win = doc.defaultView;
  const originalMinHeight = root.style.minHeight;
  const papers: HTMLElement[] = [], observed = new Map<Element, { width: number; height: number }>();
  let destroyed = false, frame: number | undefined, lastDocument: typeof view.state.doc | undefined, lastPage = "";
  const key = (page: DocumentPage) => [page.width, page.height, page.margins.top, page.margins.right, page.margins.bottom, page.margins.left].join("/");
  const pixels = (value: number) => `${Math.round(value * 1000) / 1000}px`;
  const setStyle = (element: HTMLElement, name: "height" | "top" | "minHeight", value: string) => { if (element.style[name] !== value) element.style[name] = value; };
  const rememberSizes = () => {
    for (const element of observed.keys()) { const bounds = element.getBoundingClientRect(); observed.set(element, { width: bounds.width, height: bounds.height }); }
  };
  const observer = win?.ResizeObserver ? new win.ResizeObserver(entries => {
    // Our own spacer changes also resize ancestors. Compare their final sizes
    // rather than reacting to every notification and creating a feedback loop.
    if (entries.some(({ target }) => {
      const previous = observed.get(target), bounds = target.getBoundingClientRect();
      return !previous || Math.abs(previous.width - bounds.width) > .25 || Math.abs(previous.height - bounds.height) > .25;
    })) schedule();
  }) : undefined;
  function refreshObserved() {
    const next = new Set<Element>([root, ...Array.from(root.children)]);
    for (const element of observed.keys()) if (!next.has(element)) { observer?.unobserve(element); observed.delete(element); }
    for (const element of next) if (!observed.has(element)) { observed.set(element, { width: 0, height: 0 }); observer?.observe(element); }
  }
  function layout() {
    frame = undefined;
    if (destroyed || !win || root.isConnected === false) return;
    const initial = root.getBoundingClientRect();
    const cssWidth = parseFloat(win.getComputedStyle(root).width) || root.offsetWidth;
    const scale = initial.width / cssWidth;
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    const viewport = root.closest<HTMLElement>(".lxd-document-viewport");
    const scroll = viewport ? { top: viewport.scrollTop, left: viewport.scrollLeft } : undefined;
    const page = getPage();
    lastDocument = view.state.doc; lastPage = key(page);
    const boundaries = Array.from(root.querySelectorAll<HTMLElement>(boundarySelector));
    const breaks: HTMLElement[] = [];
    for (const boundary of boundaries) {
      const inTable = !!boundary.closest("td,th");
      if (inTable) {
        boundary.setAttribute("data-lxd-page-boundary-in-table", "true");
        boundary.style.removeProperty("height");
      } else {
        boundary.removeAttribute("data-lxd-page-boundary-in-table");
        // A nonzero measuring height keeps margins from collapsing through an
        // empty block break. Subtract it below so it adds no saved-page space.
        setStyle(boundary, "height", `${measuringHeight}px`); breaks.push(boundary);
      }
    }
    setStyle(root, "minHeight", "0px");
    const natural = root.getBoundingClientRect();
    const offsets = breaks.map((boundary, index) => (boundary.getBoundingClientRect().top - natural.top) / scale - index * measuringHeight);
    const plan = calculateDocumentPagination(offsets, natural.height / scale - breaks.length * measuringHeight, page.height * millimetres, page.margins.top * millimetres, page.margins.bottom * millimetres);
    breaks.forEach((boundary, index) => setStyle(boundary, "height", pixels(plan.spacers[index])));
    setStyle(root, "minHeight", pixels(plan.height));
    const origin = (root.getBoundingClientRect().top - layer.getBoundingClientRect().top) / scale;
    while (papers.length > plan.papers.length) papers.pop()!.remove();
    plan.papers.forEach((paper, index) => {
      let element = papers[index];
      if (!element) {
        element = doc.createElement("div"); element.className = "lxd-page-paper";
        element.setAttribute("aria-hidden", "true"); layer.appendChild(element); papers.push(element);
      }
      element.setAttribute("data-lxd-display-page", String(index + 1));
      setStyle(element, "top", pixels(origin + paper.top)); setStyle(element, "height", pixels(paper.height));
    });
    refreshObserved(); rememberSizes();
    // Measuring collapsed spacers can temporarily shrink the scroll range and
    // trigger clamping/anchoring. Final geometry has now been read; restore the
    // user's position before any intentional caret/page reveal by the caller.
    // Native setters clamp naturally if the document really became shorter.
    if (viewport && scroll) { viewport.scrollTop = scroll.top; viewport.scrollLeft = scroll.left; }
    afterLayout?.();
  }
  function schedule() {
    if (destroyed || frame !== undefined || !win) return;
    frame = win.requestAnimationFrame(layout);
  }
  function update() {
    // Selection/search updates must not collapse and remeasure every spacer.
    if (frame !== undefined || view.state.doc !== lastDocument || key(getPage()) !== lastPage) {
      if (frame !== undefined) win?.cancelAnimationFrame(frame);
      layout();
    }
  }
  const loaded = () => schedule();
  root.addEventListener("load", loaded, true);
  win?.addEventListener("resize", loaded);
  doc.fonts?.addEventListener("loadingdone", loaded);
  void doc.fonts?.ready.then(() => { if (!destroyed) schedule(); }, () => {});
  // CSS zoom does not consistently notify ResizeObserver. Watch only container
  // attributes, not the spacer styles that this helper changes itself.
  const attributes = win?.MutationObserver ? new win.MutationObserver(loaded) : undefined;
  for (let element = root.parentElement; element; element = element.parentElement) {
    attributes?.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    if (element.hasAttribute("data-likex-document")) break;
  }
  refreshObserved(); schedule();
  return { schedule, update, destroy() {
    if (destroyed) return;
    destroyed = true;
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
    observer?.disconnect(); attributes?.disconnect(); observed.clear();
    root.removeEventListener("load", loaded, true); win?.removeEventListener("resize", loaded);
    doc.fonts?.removeEventListener("loadingdone", loaded);
    root.style.minHeight = originalMinHeight;
    for (const paper of papers) paper.remove(); papers.length = 0;
  } };
}
