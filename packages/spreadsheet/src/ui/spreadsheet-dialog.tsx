"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** Shared form dialog, scoped to the embedded component rather than the host window. */
export function SpreadsheetDialog({ title, children, onClose, actions, initialFocusRef, className = "" }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const anchor = useCallback((node: HTMLSpanElement | null) => {
    if (node) setRegion(node.closest<HTMLElement>("[data-likex-spreadsheet]"));
  }, []);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const previous = element.ownerDocument.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? element.querySelector<HTMLElement>(focusableSelector) ?? element).focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [region, initialFocusRef]);
  return <><span hidden ref={anchor} />{region && createPortal(
    <div className="lxs-dialog-backdrop lxs-form-dialog-backdrop"
      onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
      onPointerDown={event => {
        event.stopPropagation();
        if (event.target === event.currentTarget) { event.preventDefault(); onClose(); }
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "Tab") {
          const controls = [...(panel.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
            .filter(element => !element.closest("[hidden]") && element.tabIndex >= 0);
          if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
          const first = controls[0], last = controls.at(-1)!;
          if (event.shiftKey && (event.target === first || event.target === panel.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (event.target === last || event.target === panel.current)) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div ref={panel} className={`lxs-dialog lxs-form-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}>
        <div className="lxs-form-dialog-heading"><h2 id={`${id}-title`}>{title}</h2>
          <button type="button" aria-label="閉じる" onClick={onClose}>×</button></div>
        {children}
        {actions && <div className="lxs-dialog-actions">{actions}</div>}
      </div>
    </div>, region,
  )}</>;
}
