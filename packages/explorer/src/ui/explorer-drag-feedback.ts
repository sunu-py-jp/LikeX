import { getDragScrollDelta, type DragPoint } from "../core";

/** A bounded text-only native drag image; file contents and thumbnails are never read. */
export function createExplorerDragPreview(source: HTMLElement | null | undefined, transfer: DataTransfer, title: string, count: number): () => void {
  const ownerDocument = source?.ownerDocument, view = ownerDocument?.defaultView;
  if (!source || !ownerDocument?.body || !view || typeof transfer.setDragImage !== "function") return () => {};
  const element = ownerDocument.createElement("div"), label = ownerDocument.createElement("span");
  element.className = "lxe:drag-preview";
  element.dataset.explorerDragPreview = "true";
  element.dataset.likexExplorer = "";
  element.setAttribute("aria-hidden", "true");
  label.textContent = title.slice(0, 120);
  element.append(label);
  if (count > 1) { const badge = ownerDocument.createElement("strong"); badge.textContent = `+${count - 1}`; element.append(badge); }
  const styles = view.getComputedStyle(source);
  for (const key of ["--explorer-panel", "--explorer-foreground", "--explorer-border", "--explorer-accent"]) element.style.setProperty(key, styles.getPropertyValue(key));
  const bounds = source.getBoundingClientRect();
  element.style.left = `${Math.max(0, bounds.left)}px`;
  element.style.top = `${Math.max(0, bounds.top)}px`;
  ownerDocument.body.append(element);
  try { transfer.setDragImage(element, 16, 16); } catch { element.remove(); return () => {}; }
  // The browser snapshots the image after dragstart returns, before the next task.
  let timer: number | undefined;
  const remove = () => { if (timer !== undefined) view.clearTimeout(timer); timer = undefined; element.remove(); };
  timer = view.setTimeout(remove, 0);
  return remove;
}

/** One scroll viewport, shared by native file drags and pointer-driven tab drags. */
export function createExplorerViewportScroller(host: HTMLElement, axes: "x" | "y" | "both" = "both") {
  const candidate = host.ownerDocument.defaultView;
  if (!candidate || typeof candidate.requestAnimationFrame !== "function") return { update() {}, stop() {} };
  const view = candidate;
  let point: DragPoint | null = null, frame: number | null = null, lastFrame = 0;
  const stop = () => { if (frame !== null) view.cancelAnimationFrame(frame); frame = null; point = null; lastFrame = 0; };
  function tick(time: number) {
    frame = null;
    if (!host.isConnected || !point) { stop(); return; }
    const bounds = host.getBoundingClientRect();
    const delta = getDragScrollDelta(point, { left: Math.max(0, bounds.left), top: Math.max(0, bounds.top), right: Math.min(view.innerWidth, bounds.right), bottom: Math.min(view.innerHeight, bounds.bottom) }, lastFrame ? time - lastFrame : 16, { axes });
    lastFrame = time;
    const left = host.scrollLeft, top = host.scrollTop;
    host.scrollLeft += delta.x; host.scrollTop += delta.y;
    // At a boundary, wait for a new dragover instead of keeping an idle loop alive.
    if (host.scrollLeft !== left || host.scrollTop !== top) frame = view.requestAnimationFrame(tick);
  }
  return { stop, update(next: DragPoint) { if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return; point = next; if (frame === null) { lastFrame = 0; frame = view.requestAnimationFrame(tick); } } };
}

/** View-only native DND scrolling. Hosts opt in explicitly, so the page never scrolls. */
export function installExplorerDragAutoScroll(root: HTMLElement): () => void {
  const ownerDocument = root.ownerDocument, view = ownerDocument.defaultView;
  if (!view || typeof view.requestAnimationFrame !== "function") return () => {};
  let host: HTMLElement | null = null, scroller: ReturnType<typeof createExplorerViewportScroller> | null = null;
  const stop = () => { scroller?.stop(); scroller = null; host = null; };
  function track(event: DragEvent) {
    if (!event.dataTransfer?.types.some(type => type === "application/x-explorer" || type === "Files")) return;
    const target = event.target as Element | null;
    const candidate = target?.closest?.<HTMLElement>("[data-explorer-drag-scroll]");
    if (candidate && root.contains(candidate) && candidate !== host) {
      scroller?.stop(); host = candidate;
      const axes = host.dataset.explorerDragScroll === "x" ? "x" : host.dataset.explorerDragScroll === "y" ? "y" : "both";
      scroller = createExplorerViewportScroller(host, axes);
    }
    // A pointer outside the last viewport keeps scrolling in that direction.
    if (!host || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    scroller?.update({ x: event.clientX, y: event.clientY });
  }
  function leaveDocument(event: DragEvent) { if (event.target === ownerDocument.documentElement && !event.relatedTarget) stop(); }
  function key(event: KeyboardEvent) { if (event.key === "Escape") stop(); }
  ownerDocument.addEventListener("dragover", track, true);
  ownerDocument.addEventListener("drop", stop, true);
  ownerDocument.addEventListener("dragend", stop, true);
  ownerDocument.addEventListener("dragleave", leaveDocument, true);
  ownerDocument.addEventListener("keydown", key, true);
  view.addEventListener("blur", stop);
  return () => {
    stop(); ownerDocument.removeEventListener("dragover", track, true); ownerDocument.removeEventListener("drop", stop, true);
    ownerDocument.removeEventListener("dragend", stop, true); ownerDocument.removeEventListener("dragleave", leaveDocument, true); ownerDocument.removeEventListener("keydown", key, true); view.removeEventListener("blur", stop);
  };
}
