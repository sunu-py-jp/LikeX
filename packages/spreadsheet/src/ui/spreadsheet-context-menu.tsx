"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { SpreadsheetContextMenuController } from "../state/use-spreadsheet-context-menu";
import { SpreadsheetConfirmDialog } from "./spreadsheet-confirm-dialog";

function Menu({ c, root }: { c: SpreadsheetContextMenuController; root: RefObject<HTMLElement | null> }) {
  const element = useRef<HTMLDivElement>(null);
  const captured = c.menu!;
  const latest = useRef(c);
  useLayoutEffect(() => { latest.current = c; });
  useLayoutEffect(() => {
    const menu = element.current, region = root.current;
    if (!menu || !region) return;
    const bounds = region.getBoundingClientRect();
    const viewport = region.ownerDocument.defaultView;
    const originX = bounds.left + region.clientLeft, originY = bounds.top + region.clientTop;
    const left = Math.max(0, originX) + 4, top = Math.max(0, originY) + 4;
    const right = Math.min(originX + region.clientWidth, viewport?.innerWidth ?? bounds.right) - 4;
    const bottom = Math.min(originY + region.clientHeight, viewport?.innerHeight ?? bounds.bottom) - 4;
    menu.style.maxWidth = `${Math.min(360, Math.max(0, right - left))}px`;
    menu.style.minWidth = `${Math.min(180, Math.max(0, right - left))}px`;
    menu.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    menu.style.left = `${Math.max(left, Math.min(captured.x, right - menu.offsetWidth)) - originX + region.scrollLeft}px`;
    menu.style.top = `${Math.max(top, Math.min(captured.y, bottom - menu.offsetHeight)) - originY + region.scrollTop}px`;
    (menu.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menu).focus({ preventScroll: true });
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) latest.current.closeMenu(); };
    const document = region.ownerDocument;
    document.addEventListener("pointerdown", outside, true);
    const close = () => latest.current.closeMenu();
    const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
    viewport?.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      viewport?.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
      if (captured.returnFocus?.isConnected && (!document.activeElement || document.activeElement === document.body || menu.contains(document.activeElement))) captured.returnFocus.focus({ preventScroll: true });
    };
  }, [captured, root]);
  return <div ref={element} className="lxs-context-menu" role="menu" tabIndex={-1} aria-label={captured.context.target.kind === "sheet" ? "シートの操作" : "セルの操作"} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); c.closeMenu(); return; }
      const buttons = [...(element.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        const button = buttons[next], menu = element.current;
        button?.focus({ preventScroll: true });
        if (button && menu) {
          if (button.offsetTop < menu.scrollTop) menu.scrollTop = button.offsetTop;
          else if (button.offsetTop + button.offsetHeight > menu.scrollTop + menu.clientHeight)
            menu.scrollTop = button.offsetTop + button.offsetHeight - menu.clientHeight;
        }
      }
    }}>
    {captured.duplicateSheet && <button type="button" role="menuitem" disabled={captured.duplicateSheet.disabled} onClick={c.duplicateSheet}>複製</button>}
    {captured.items.map(item => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} onClick={() => c.selectItem(item)}>
      {item.icon != null && <span aria-hidden="true">{item.icon}</span>}<span>{item.label}</span>
    </button>)}
    {captured.deleteSheet && <>
      {(captured.items.length > 0 || captured.duplicateSheet) && <div role="separator" className="lxs-context-menu-separator" />}
      <button type="button" role="menuitem" disabled={captured.deleteSheet.disabled} onClick={c.deleteSheet}>削除</button>
    </>}
  </div>;
}

export function SpreadsheetContextMenu({ controller: c, root }: { controller: SpreadsheetContextMenuController; root: RefObject<HTMLElement | null> }) {
  return <>
    {c.menu && <Menu c={c} root={root} />}
    {c.state.phase !== "idle" && c.state.phase !== "confirming" && <div className="lxs-context-menu-progress" role="status">
      <span>{c.state.label}を処理しています…</span><button type="button" onClick={c.cancel}>キャンセル</button>
    </div>}
    {c.state.phase === "confirming" && <SpreadsheetConfirmDialog title="処理結果を反映しますか？" confirmLabel="反映する" onConfirm={c.confirm} onCancel={c.cancel}>
      <p>{c.state.description || `${c.state.label}の処理結果を、開始時に指定した対象へ反映します。`}</p>
    </SpreadsheetConfirmDialog>}
    {c.state.phase === "idle" && c.state.error && <div className="lxs-context-menu-error" role="alert">{c.state.error}</div>}
  </>;
}
