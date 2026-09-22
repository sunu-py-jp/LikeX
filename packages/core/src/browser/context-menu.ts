export type ContextMenuAction = Readonly<{
  id: string;
  label: string;
  onSelect: () => unknown | Promise<unknown>;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
}>;
export type ContextMenuSurfaceOptions = {
  anchor: HTMLElement;
  x?: number;
  y?: number;
  items: readonly ContextMenuAction[];
  onError?: (error: unknown) => void;
  onClose?: () => void;
};

const activeMenus = new WeakMap<Document, () => void>();

/** A small DOM adapter shared by all LikeX views; it never reads or changes a model. */
export function openContextMenu(options: ContextMenuSurfaceOptions): () => void {
  const { anchor, onError, onClose } = options;
  const doc = anchor.ownerDocument, win = doc.defaultView;
  activeMenus.get(doc)?.();
  if (!win || !anchor.isConnected || !options.items.length) return () => {};
  const reportError = (error: unknown) => { try { void Promise.resolve(onError?.(error)).catch(() => {}); } catch { /* Error observers must not create unhandled rejections. */ } };
  const items = options.items.map(item => ({ ...item }));
  const previousFocus = doc.activeElement as HTMLElement | null;
  const menu = doc.createElement("div");
  menu.setAttribute("data-likex-context-menu", "");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "操作メニュー");
  menu.tabIndex = -1;
  const computed = win.getComputedStyle(anchor), foreground = computed.color;
  const theme = anchor.closest("[data-color-mode], [data-theme]");
  const explicitMode = theme?.getAttribute("data-color-mode") ?? theme?.getAttribute("data-theme");
  const rgb = foreground.match(/^rgba?\(\s*([\d.]+)(%)?[, ]+([\d.]+)(%)?[, ]+([\d.]+)(%)?/i);
  const srgb = foreground.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  const channels = rgb ? [1, 3, 5].map(index => Number(rgb[index]) * (rgb[index + 1] ? 2.55 : 1)) : srgb ? srgb.slice(1).map(value => Number(value) * 255) : null;
  const dark = explicitMode === "dark" || explicitMode !== "light" && (computed.colorScheme === "dark" || computed.colorScheme !== "light" && !!channels && channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > 160);
  const viewport = win.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0, viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? win.innerWidth, viewportHeight = viewport?.height ?? win.innerHeight;
  const insetX = Math.min(8, viewportWidth / 2), insetY = Math.min(8, viewportHeight / 2);
  const availableWidth = Math.max(0, viewportWidth - insetX * 2), availableHeight = Math.max(0, viewportHeight - insetY * 2);
  const background = dark ? "#27282b" : "#fff", color = dark ? "#f1f3f4" : "#25272b", hover = dark ? "#3c4043" : "#edf2f8", border = dark ? "#50545a" : "#dadce0";
  Object.assign(menu.style, { position: "fixed", zIndex: "2147483000", boxSizing: "border-box", minWidth: `${Math.min(192, availableWidth)}px`, maxWidth: `${availableWidth}px`, maxHeight: `${availableHeight}px`, overflowY: "auto", padding: "5px", border: `1px solid ${border}`, borderRadius: "9px", background, color, boxShadow: "0 5px 22px #0003", font: '13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', colorScheme: dark ? "dark" : "light" });
  let closed = false;
  let observer: MutationObserver | undefined;
  const buttons: HTMLButtonElement[] = [];
  const close = (restore = false) => {
    if (closed) return;
    closed = true; menu.remove(); observer?.disconnect();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("contextmenu", outside, true);
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("scroll", scrolled, true);
    win.removeEventListener("resize", dismiss);
    win.removeEventListener("blur", dismiss);
    viewport?.removeEventListener("resize", dismiss); viewport?.removeEventListener("scroll", dismiss);
    if (activeMenus.get(doc) === dispose) activeMenus.delete(doc);
    if (restore) {
      const target = previousFocus?.isConnected && previousFocus !== doc.body ? previousFocus : anchor;
      if (target.isConnected) {
        const temporaryTabIndex = target.tabIndex < 0 && !target.hasAttribute("tabindex");
        try { if (temporaryTabIndex) target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
        catch (error) { reportError(error); }
        finally { if (temporaryTabIndex) target.removeAttribute("tabindex"); }
      }
    }
    try { void Promise.resolve(onClose?.()).catch(reportError); } catch (error) { reportError(error); }
  };
  const dispose = () => close(false);
  const dismiss = () => close(false);
  function outside(event: Event) { if (!menu.contains(event.target as Node)) close(false); }
  function scrolled(event: Event) { if (!menu.contains(event.target as Node)) close(false); }
  const enabled = () => buttons.filter(button => !button.disabled);
  let typed = "", typedAt = 0;
  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(true); return; }
    const available = enabled(), index = available.indexOf(doc.activeElement as HTMLButtonElement);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); event.stopPropagation(); if (index >= 0) available[index].click(); return;
    }
    let next: HTMLButtonElement | undefined;
    const navigation = ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key);
    if (navigation) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "ArrowDown") next = available[(index + 1) % available.length];
      else if (event.key === "ArrowUp") next = available[index < 0 ? available.length - 1 : (index - 1 + available.length) % available.length];
      else if (event.key === "Home") next = available[0];
      else next = available.at(-1);
    } else if (event.key.length === 1 && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      const now = Date.now(); typed = now - typedAt < 700 ? typed + event.key : event.key; typedAt = now;
      const repeated = [...typed].every(char => char.toLocaleLowerCase() === event.key.toLocaleLowerCase());
      const prefix = (repeated ? event.key : typed).toLocaleLowerCase();
      const offset = prefix.length === 1 ? index + 1 : Math.max(index, 0);
      next = available.map((_, step) => available[(offset + step) % available.length]).find(button => button.textContent?.toLocaleLowerCase().startsWith(prefix));
    }
    if (next) { next.focus({ preventScroll: true }); next.scrollIntoView?.({ block: "nearest" }); }

  }
  for (const [index, item] of items.entries()) {
    if (index && item.separatorBefore) { const separator = doc.createElement("div"); separator.setAttribute("role", "separator"); Object.assign(separator.style, { height: "1px", background: border, margin: "4px 3px" }); menu.append(separator); }
    const button = doc.createElement("button");
    button.type = "button"; button.setAttribute("role", "menuitem"); button.dataset.menuId = item.id;
    button.disabled = !!item.disabled; button.tabIndex = -1;
    Object.assign(button.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "28px", width: "100%", boxSizing: "border-box", textAlign: "left", border: "0", borderRadius: "5px", padding: "8px 10px", background: "transparent", color: item.danger ? dark ? "#ffb4ab" : "#b3261e" : color, font: "inherit", cursor: item.disabled ? "default" : "pointer", opacity: item.disabled ? ".42" : "1", outline: "none" });
    const label = doc.createElement("span"); label.textContent = item.label; Object.assign(label.style, { minWidth: "0", overflowWrap: "anywhere" }); button.append(label);
    if (item.shortcut) { const shortcut = doc.createElement("span"); shortcut.textContent = item.shortcut; Object.assign(shortcut.style, { fontSize: "11px", opacity: ".65", whiteSpace: "nowrap" }); button.append(shortcut); }
    const highlight = () => { if (!button.disabled) button.style.background = hover; };
    const unhighlight = () => { button.style.background = "transparent"; };
    button.addEventListener("pointerenter", () => { if (!button.disabled) button.focus({ preventScroll: true }); });
    button.addEventListener("focus", highlight); button.addEventListener("blur", unhighlight);
    button.addEventListener("click", () => {
      if (button.disabled || closed) return;
      if (!anchor.isConnected) { close(false); return; }
      close(true);
      try { void Promise.resolve(item.onSelect()).catch(reportError); } catch (error) { reportError(error); }
    });
    buttons.push(button); menu.append(button);
  }
  doc.body.append(menu);
  const bounds = anchor.getBoundingClientRect(), size = menu.getBoundingClientRect();
  const keyboard = !options.x && !options.y;
  const x = keyboard ? bounds.left + 8 : Number.isFinite(options.x) ? options.x! : bounds.left;
  const y = keyboard ? bounds.bottom : Number.isFinite(options.y) ? options.y! : bounds.bottom;
  menu.style.left = `${Math.max(viewportLeft + insetX, Math.min(x, viewportLeft + viewportWidth - size.width - insetX))}px`;
  menu.style.top = `${Math.max(viewportTop + insetY, Math.min(y, viewportTop + viewportHeight - size.height - insetY))}px`;
  doc.addEventListener("pointerdown", outside, true); doc.addEventListener("contextmenu", outside, true);
  doc.addEventListener("keydown", keydown, true); doc.addEventListener("scroll", scrolled, true);
  win.addEventListener("resize", dismiss); win.addEventListener("blur", dismiss);
  viewport?.addEventListener("resize", dismiss); viewport?.addEventListener("scroll", dismiss);
  if (win.MutationObserver) { observer = new win.MutationObserver(() => { if (!anchor.isConnected || !menu.isConnected) close(false); }); observer.observe(doc.body, { childList: true, subtree: true }); }
  activeMenus.set(doc, dispose); (enabled()[0] ?? menu).focus({ preventScroll: true });
  return dispose;
}
