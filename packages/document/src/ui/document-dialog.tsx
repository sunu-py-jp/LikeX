import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function DocumentDialog({ title, onClose, onSubmit, children, submitLabel = "挿入", hideCancel = false }: { title: string; onClose(): void; onSubmit(data: FormData): void; children: ReactNode; submitLabel?: string; hideCancel?: boolean }) {
  const id = useId(), form = useRef<HTMLFormElement>(null), backdrop = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(backdrop.current?.closest<HTMLElement>(".lxd-root") ?? null); }, []);
  useEffect(() => {
    const node = form.current, previous = node?.ownerDocument.activeElement as HTMLElement | null;
    node?.querySelector<HTMLInputElement>("input,select,textarea")?.focus();
    return () => previous?.focus();
  }, [host]);
  const content = <div ref={backdrop} className="lxd-dialog-backdrop" onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const items = [...(form.current?.querySelectorAll<HTMLElement>("button,input,select,textarea,[tabindex='0']") ?? [])].filter(item => !item.hasAttribute("disabled"));
      const active = event.currentTarget.ownerDocument.activeElement;
      if (event.shiftKey && active === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && active === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  }}><form ref={form} className="lxd-dialog" role="dialog" aria-modal="true" aria-labelledby={id} onSubmit={event => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
    <div className="lxd-dialog-heading"><h2 id={id}>{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}><X size={18} /></button></div>
    <div className="lxd-dialog-content">{children}</div><div className="lxd-dialog-actions">{!hideCancel && <button type="button" onClick={onClose}>キャンセル</button>}<button className="lxd-primary-button" type="submit">{submitLabel}</button></div>
  </form></div>;
  return host ? createPortal(content, host) : content;
}
