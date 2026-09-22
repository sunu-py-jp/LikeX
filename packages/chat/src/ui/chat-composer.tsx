import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Paperclip, Send, X } from "lucide-react";
import type { ChatAttachment } from "../model";
export type ChatDraft = { text: string; attachments: ChatAttachment[] };
export function ChatComposer({ draft, onDraft, disabled, busy, label, canAttach, onUpload, onSend }: {
  draft: ChatDraft; onDraft(draft: ChatDraft): void; disabled: boolean; busy: boolean; label: string; canAttach: boolean;
  onUpload(files: File[]): Promise<ChatAttachment[] | null>; onSend(draft: ChatDraft): Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null), revision = useRef(0), labelId = useId();
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The keyed composer is recreated on target changes. Ignore late draft updates.
  const currentDraft = useRef(draft); useLayoutEffect(() => { currentDraft.current = draft; }, [draft]);
  function update(next: ChatDraft) { revision.current++; onDraft(next); }
  async function submit() {
    if (disabled || busy || pending || !draft.text.trim() && !draft.attachments.length) return;
    const current = revision.current; setPending(true);
    try { if (await onSend(draft) && mounted.current && revision.current === current) update({ text: "", attachments: [] }); }
    finally { if (mounted.current) setPending(false); }
  }
  return <form className="lxh-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
    {!!draft.attachments.length && <div className="lxh-draft-files">{draft.attachments.map(file => <span key={file.id}><Paperclip size={13} />{file.name}<button type="button" disabled={disabled || busy || pending} aria-label={`${file.name}を外す`} onClick={() => update({ ...draft, attachments: draft.attachments.filter(item => item.id !== file.id) })}><X size={13} /></button></span>)}</div>}
    <label className="lxh-sr-only" id={labelId}>{label}</label><textarea aria-labelledby={labelId} placeholder={label} rows={2} value={draft.text} disabled={disabled || busy || pending} onChange={event => update({ ...draft, text: event.target.value })} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void submit(); }
    }} />
    <div className="lxh-composer-tools"><div>{canAttach && <><input type="file" ref={input} multiple hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; const version = revision.current;
      if (disabled || busy || !files.length) return;
      setPending(true); void onUpload(files).then(result => { if (result && mounted.current && revision.current === version) update({ ...currentDraft.current, attachments: [...currentDraft.current.attachments, ...result] }); }).finally(() => { if (mounted.current) setPending(false); });
    }} /><button type="button" title="ファイルを添付" aria-label="ファイルを添付" disabled={disabled || busy || pending} onClick={() => input.current?.click()}><Paperclip size={19} /></button></>}
    <span className="lxh-composer-hint">Shift + Enter で改行</span></div><button type="submit" className="lxh-send" aria-label="送信" disabled={disabled || busy || pending || !draft.text.trim() && !draft.attachments.length}>{busy || pending ? <LoaderCircle size={18} className="lxh-spin" /> : <Send size={18} />}</button></div>
  </form>;
}
