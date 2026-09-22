import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
export function ChatDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), titleId = useId();
  useEffect(() => {
    const node = ref.current, previous = node?.ownerDocument.activeElement;
    node?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => { if (typeof HTMLElement !== "undefined" && previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="lxh-modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="lxh-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')];
        const first = items[0], last = items[items.length - 1], active = event.currentTarget.ownerDocument.activeElement;
        if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
      }
    }}><header><h2 id={titleId}>{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}><X size={18} /></button></header>{children}</div>
  </div>;
}
