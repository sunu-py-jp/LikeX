"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";

/** Confirmation stays inside the embedded spreadsheet and does not intercept its host page. */
export function SpreadsheetConfirmDialog({ title, children, confirmLabel, disabled, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel: string; disabled?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const previous = cancel.current?.ownerDocument.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="lxs-dialog-backdrop" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()} onPointerDown={event => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onCancel();
  }} onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && ["s", "z", "y", "a"].includes(event.key.toLowerCase())) event.preventDefault();
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key === "Tab") {
      event.preventDefault();
      if (!disabled && event.target === cancel.current) confirm.current?.focus();
      else cancel.current?.focus();
    }
  }}>
    <div className="lxs-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-description`}>{children}</div>
      <div className="lxs-dialog-actions">
        <button type="button" ref={cancel} onClick={onCancel}>キャンセル</button>
        <button type="button" ref={confirm} className="lxs-dialog-confirm" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
