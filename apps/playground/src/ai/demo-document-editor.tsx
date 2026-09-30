import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./demo-document-editor.css";

export type DemoDocumentEditorProps = {
  title: string;
  kind: "slide" | "spreadsheet";
  dirty: boolean;
  busy: boolean;
  onBack(): void;
  onSave(): Promise<boolean>;
  children: ReactNode;
  colorMode: "light" | "dark" | "system";
  primaryColor?: string;
};

/** The host owns persistence; this frame leaves only after an explicit decision. */
export function DemoDocumentEditor(props: DemoDocumentEditorProps) {
  const { title, kind, dirty, busy, children, colorMode, primaryColor } = props;
  const [confirming, setConfirming] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const latest = useRef(props), lifetime = useRef<object | null>(null), locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), back = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  useLayoutEffect(() => { latest.current = props; });
  useLayoutEffect(() => {
    lifetime.current = {};
    return () => { lifetime.current = null; };
  }, []);
  useLayoutEffect(() => {
    if (!confirming) return;
    // Native modal dialogs provide focus containment and make the editor inert.
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    cancel.current?.focus();
    return () => { if (element?.open) element.close(); };
  }, [confirming]);

  const dismiss = () => {
    if (locked.current || !lifetime.current) return;
    dialog.current?.close();
    setConfirming(false); setError("");
    back.current?.focus();
  };
  const requestBack = () => {
    if (locked.current || latest.current.busy || !lifetime.current) return;
    if (latest.current.dirty) { setError(""); setConfirming(true); return; }
    locked.current = true;
    latest.current.onBack();
  };
  const discardAndBack = () => {
    if (locked.current || latest.current.busy || !lifetime.current) return;
    locked.current = true;
    latest.current.onBack();
  };
  const saveAndBack = async () => {
    if (locked.current || latest.current.busy || !lifetime.current) return;
    const owner = lifetime.current;
    locked.current = true; setSaving(true); setError("");
    let leaving = false;
    try {
      const saved = await latest.current.onSave();
      if (lifetime.current !== owner) return;
      if (saved !== true) { setError("保存できませんでした。入力中の内容や画面のメッセージを確認してください。"); return; }
      leaving = true;
      latest.current.onBack();
    } catch (cause) {
      if (lifetime.current === owner) setError(cause instanceof Error && cause.message ? cause.message : "保存できませんでした。もう一度お試しください。");
    } finally {
      if (lifetime.current === owner && !leaving) { locked.current = false; setSaving(false); }
    }
  };
  const backLabel = `${kind === "slide" ? "スライド" : "スプレッドシート"}一覧に戻る`;

  return <section className="playground-document-editor" data-color-mode={colorMode}
    style={{ "--demo-document-primary": primaryColor ?? (kind === "slide" ? "#b95634" : "#217346") } as CSSProperties}>
    <header className="playground-document-editor-header">
      <button ref={back} type="button" onClick={requestBack} disabled={busy || saving} aria-label={backLabel} title={backLabel}>
        <span aria-hidden="true">←</span><span>一覧</span>
      </button>
      <span className="playground-document-editor-title" title={title}>{title}</span>
      <span className="playground-document-editor-status" role="status">{saving ? "保存しています…" : busy ? "処理中…" : dirty ? "未保存の変更" : "保存済み"}</span>
    </header>
    <div className="playground-document-editor-body">{children}</div>
    {confirming && <dialog ref={dialog} className="playground-document-editor-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); dismiss(); }}>
      <h2 id={titleId}>変更を保存しますか？</h2>
      <p id={descriptionId}>「{title}」に未保存の変更があります。</p>
      {error && <p className="playground-document-editor-error" role="alert">{error}</p>}
      <div className="playground-document-editor-dialog-actions">
        <button ref={cancel} type="button" onClick={dismiss} disabled={saving}>キャンセル</button>
        <button type="button" onClick={discardAndBack} disabled={busy || saving}>保存せず戻る</button>
        <button type="button" className="playground-document-editor-save" onClick={() => { void saveAndBack(); }} disabled={busy || saving}>{saving ? "保存しています…" : "保存して戻る"}</button>
      </div>
    </dialog>}
  </section>;
}
