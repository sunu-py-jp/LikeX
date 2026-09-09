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
    const left = Math.max(0, bounds.left), top = Math.max(0, bounds.top);
    const right = Math.min(bounds.right, viewport?.innerWidth ?? bounds.right);
    const bottom = Math.min(bounds.bottom, viewport?.innerHeight ?? bounds.bottom);
    menu.style.left = `${Math.max(left, Math.min(captured.x, right - menu.offsetWidth)) - bounds.left}px`;
    menu.style.top = `${Math.max(top, Math.min(captured.y, bottom - menu.offsetHeight)) - bounds.top}px`;
    menu.style.maxHeight = `${Math.max(80, bottom - top)}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: Event) => { if (!menu.contains(event.target as Node)) latest.current.closeMenu(); };
    const document = region.ownerDocument;
    document.addEventListener("pointerdown", outside, true);
    const close = () => latest.current.closeMenu();
    viewport?.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      viewport?.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      if (captured.returnFocus?.isConnected && (!document.activeElement || document.activeElement === document.body || menu.contains(document.activeElement))) captured.returnFocus.focus({ preventScroll: true });
    };
  }, [captured, root]);
  return <div ref={element} className="lxs-context-menu" role="menu" aria-label="セルの操作" onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); c.closeMenu(); return; }
      const buttons = [...(element.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {captured.items.map(item => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} onClick={() => c.selectItem(item)}>
      {item.icon != null && <span aria-hidden="true">{item.icon}</span>}<span>{item.label}</span>
    </button>)}
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
