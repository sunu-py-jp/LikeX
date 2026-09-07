type StyleTemplate = { node: HTMLElement; version: number };
type StyleTarget = {
  document: Document;
  end: Comment;
  copies: Map<Element, { node: HTMLElement; version: number }>;
};

const sources = new WeakMap<Document, ReturnType<typeof createStyleSource>>();
const styleSelector = 'style, link[rel="stylesheet"]';

/** A source document is observed once, regardless of how many windows display it. */
function createStyleSource(source: Document) {
  const targets = new Set<StyleTarget>();
  const templates = new Map<Element, StyleTemplate>();
  let ordered: Element[] = [];
  let version = 0;
  function capture(original: Element) {
    const node = original.cloneNode(true) as HTMLElement;
    if (original.tagName === "LINK") node.setAttribute("href", (original as HTMLLinkElement).href);
    templates.set(original, { node, version: ++version });
  }
  function scan() {
    ordered = [...source.querySelectorAll(styleSelector)];
    const active = new Set(ordered);
    for (const original of templates.keys()) if (!active.has(original)) templates.delete(original);
    for (const original of ordered) if (!templates.has(original)) capture(original);
  }
  function copyClasses(target: StyleTarget) {
    target.document.documentElement.className = source.documentElement.className;
    target.document.body.className = source.body.className;
  }
  function copyStyles(target: StyleTarget) {
    for (const [original, copy] of target.copies) {
      if (!templates.has(original)) { copy.node.remove(); target.copies.delete(original); }
    }
    for (const original of ordered) {
      const template = templates.get(original)!;
      const previous = target.copies.get(original);
      if (previous?.version === template.version) continue;
      const node = template.node.cloneNode(true) as HTMLElement;
      if (previous) previous.node.replaceWith(node);
      else target.document.head.insertBefore(node, target.end);
      target.copies.set(original, { node, version: template.version });
    }
    // Preserve cascade order, while keeping child-owned styles after host styles.
    let next: Node = target.end;
    for (let index = ordered.length - 1; index >= 0; index--) {
      const node = target.copies.get(ordered[index])!.node;
      if (node.nextSibling !== next) target.document.head.insertBefore(node, next);
      next = node;
    }
  }
  function containsStyles(node: Node) {
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    return element.matches("style, link") || !!element.querySelector(styleSelector);
  }
  function process(records: MutationRecord[]) {
    let classesChanged = false;
    let membershipChanged = false;
    const changedStyles = new Set<Element>();
    for (const record of records) {
      if (record.type === "attributes" && record.attributeName === "class" &&
        (record.target === source.documentElement || record.target === source.body)) {
        classesChanged = true;
        continue;
      }
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      const style = element?.closest("style, link");
      if (style) {
        changedStyles.add(style);
        if (record.type === "attributes" && record.attributeName === "rel") membershipChanged = true;
      } else if (record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].some(containsStyles)) membershipChanged = true;
    }
    if (membershipChanged) scan();
    for (const original of changedStyles) if (templates.has(original)) capture(original);
    if (!classesChanged && !membershipChanged && !changedStyles.size) return;
    for (const target of targets) {
      // One closed or navigated target must not prevent other windows updating.
      try {
        if (classesChanged) copyClasses(target);
        if (membershipChanged || changedStyles.size) copyStyles(target);
      } catch { /* The workspace lifecycle removes unavailable windows. */ }
    }
  }
  scan();
  const Observer = source.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(process) : null;
  observer?.observe(source.head, { subtree: true, childList: true, attributes: true, characterData: true });
  observer?.observe(source.documentElement, { attributes: true, attributeFilter: ["class"] });
  observer?.observe(source.body, { subtree: true, childList: true, attributes: true, characterData: true });
  return {
    subscribe(target: StyleTarget) {
      // Flush pending mutations before initializing a later popup from our cache.
      const pending = observer?.takeRecords?.();
      if (pending?.length) process(pending);
      if (!observer) { scan(); for (const original of ordered) capture(original); }
      copyStyles(target); copyClasses(target); targets.add(target);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        targets.delete(target);
        if (!targets.size) { observer?.disconnect(); sources.delete(source); }
      };
    },
    disposeUnused() { if (!targets.size) { observer?.disconnect(); sources.delete(source); } },
  };
}

/** Copy compiled host CSS without requiring any host-specific popup route. */
export function prepareDetachedDocument(source: Document, target: Document) {
  target.title = "エクスプローラー";
  target.documentElement.lang = source.documentElement.lang || "ja";
  const base = target.createElement("base"); base.href = source.baseURI; target.head.appendChild(base);
  const end = target.createComment("Explorer host styles"); target.head.appendChild(end);
  const shared = sources.get(source) ?? createStyleSource(source);
  sources.set(source, shared);
  let dispose: (() => void) | undefined;
  try {
    dispose = shared.subscribe({ document: target, end, copies: new Map() });
    target.body.style.margin = "0";
    const container = target.createElement("div"); container.style.height = "100dvh"; target.body.appendChild(container);
    return { container, dispose };
  } catch (error) {
    dispose?.(); shared.disposeUnused();
    throw error;
  }
}
