import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function DocumentDialog({ title, onClose, onSubmit, children }: { title: string; onClose(): void; onSubmit(data: FormData): void; children: ReactNode }) {
  const id = useId(), form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const node = form.current, previous = node?.ownerDocument.activeElement as HTMLElement | null;
    node?.querySelector<HTMLInputElement>("input,select")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="lxd-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      const items = [...(form.current?.querySelectorAll<HTMLElement>("button,input,select,[tabindex='0']") ?? [])].filter(item => !item.hasAttribute("disabled"));
      const active = event.currentTarget.ownerDocument.activeElement;
      if (event.shiftKey && active === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && active === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  }}><form ref={form} className="lxd-dialog" role="dialog" aria-modal="true" aria-labelledby={id} onSubmit={event => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}>
    <div className="lxd-dialog-heading"><h2 id={id}>{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}><X size={18} /></button></div>
    <div className="lxd-dialog-content">{children}</div><div className="lxd-dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="lxd-primary-button" type="submit">挿入</button></div>
  </form></div>;
}
