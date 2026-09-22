"use client";
import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ForwardRefExoticComponent, MouseEvent, PropsWithoutRef, RefAttributes } from "react";
import { ArrowDownToLine, ArrowUp, Bot, Check, FileText, LoaderCircle, MessageSquare, Paperclip, Pencil, Plus, Redo2, RefreshCw, Save, Square, Trash2, Undo2, Upload, UserRound, X } from "lucide-react";
import { createPrimaryColorPalette } from "./core";
import { openContextMenu, type ContextMenuAction } from "./browser";
import { AICHAT_LIMITS, createAIChat, getAIChatConversation, parseAIChat } from "./model";
import type { AIChatAttachment, AIChatCommand, AIChatMessage } from "./model";
import { createAIChatSession } from "./state/session";
import type { AIChatHandle, AIChatProps } from "./aichat-types";
const roleNames = { user: "あなた", assistant: "アシスタント", system: "システム", tool: "ツール" };
const toolNames = { pending: "待機中", running: "実行中", complete: "完了", error: "エラー" };

export const LikeAIChat: ForwardRefExoticComponent<PropsWithoutRef<AIChatProps> & RefAttributes<AIChatHandle>> = forwardRef<AIChatHandle, AIChatProps>(function LikeAIChat(props, ref) {
  const [session] = useState(() => createAIChatSession(props.initialAIChat ?? createAIChat(), props));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useLayoutEffect(() => { session.configure(props); });
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const [selectedId, setSelectedId] = useState(props.initialConversationId ?? snapshot.model.conversations[0].id);
  const conversation = getAIChatConversation(snapshot.model, selectedId) ?? snapshot.model.conversations[0];
  const selectedRef = useRef(conversation.id); selectedRef.current = conversation.id;
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => { const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined; if (!media) return; const changed = () => setSystemDark(media.matches); changed(); media.addEventListener("change", changed); return () => media.removeEventListener("change", changed); }, []);
  const mode = props.colorMode === "dark" || props.colorMode === "system" && systemDark ? "dark" : "light";
  const palette = createPrimaryColorPalette(props.primaryColor, mode) ?? createPrimaryColorPalette(mode === "dark" ? "#72b89b" : "#397263", mode)!;
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AIChatAttachment[]>([]);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "message" | "conversation"; id: string } | null>(null);
  const composerVersion = useRef(0);
  const menuCleanup = useRef<(() => void) | null>(null), mounted = useRef(true);
  useEffect(() => { menuCleanup.current?.(); menuCleanup.current = null; }, [snapshot, conversation.id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; menuCleanup.current?.(); }; }, []);
  const onConversationChange = props.onConversationChange;
  const previousTarget = useRef({ chatId: snapshot.model.id, conversationId: conversation.id });
  function clearTransientState() { composerVersion.current++; setDraft(""); setAttachments([]); setEditing(null); setRenaming(null); setDeleting(null); }
  useLayoutEffect(() => {
    if (selectedId !== conversation.id) setSelectedId(conversation.id);
    const target = previousTarget.current;
    if (target.chatId !== snapshot.model.id || target.conversationId !== conversation.id) {
      clearTransientState(); previousTarget.current = { chatId: snapshot.model.id, conversationId: conversation.id };
      try { void Promise.resolve(onConversationChange?.(conversation)).catch(() => {}); } catch { /* Observers do not undo a selection. */ }
    }
  }, [snapshot.model.id, conversation, selectedId, onConversationChange]);
  const uploadRef = useRef<HTMLInputElement>(null), importRef = useRef<HTMLInputElement>(null), transcriptRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const can = snapshot.editable, flags = snapshot.features;
  const activeResponse = session.getActiveResponse();
  function showMenu(event: MouseEvent<HTMLElement>, items: ContextMenuAction[]) {
    if (!items.length || event.shiftKey || (event.target as HTMLElement).closest?.('input,textarea,[contenteditable]:not([contenteditable="false"]),a')) return;
    event.preventDefault(); event.stopPropagation(); menuCleanup.current?.();
    const before = session.getSnapshot(), selected = selectedRef.current;
    menuCleanup.current = openContextMenu({ anchor: event.currentTarget, x: event.clientX, y: event.clientY,
      items: items.map(item => ({ ...item, onSelect: () => mounted.current && session.getSnapshot() === before && selectedRef.current === selected ? item.onSelect() : undefined })),
      onError: cause => session.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "操作できませんでした。" }),
    });
  }
  function messageMenu(event: MouseEvent<HTMLElement>, message: AIChatMessage) {
    const anchor = event.currentTarget;
    const items: ContextMenuAction[] = [{ id: "copy", label: "テキストをコピー", disabled: !message.content, onSelect: () => {
      const clipboard = anchor.ownerDocument.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("この環境ではテキストをコピーできません。");
      return clipboard.writeText(message.content);
    } }];
    if (flags.retry && flags.send && props.onSend && message.role === "assistant" && message.replyTo) items.push({ id: "retry", label: "応答を再生成", disabled: !can, onSelect: () => session.retry(conversation.id, message.id) });
    if (flags.edit) items.push({ id: "edit", label: "メッセージを編集", disabled: !can, separatorBefore: true, onSelect: () => setEditing({ id: message.id, content: message.content }) });
    if (flags.delete) items.push({ id: "delete", label: "メッセージを削除", disabled: !can, danger: true, onSelect: () => setDeleting({ kind: "message", id: message.id }) });
    showMenu(event, items);
  }
  function conversationMenu(event: MouseEvent<HTMLElement>, id: string, title: string) {
    const items: ContextMenuAction[] = [{ id: "open", label: "会話を開く", onSelect: () => selectConversation(id) }];
    if (flags.conversations) items.push({ id: "rename", label: "会話名を変更", disabled: !can, separatorBefore: true, onSelect: () => setRenaming({ id, title }) });
    if (flags.conversations && flags.delete) items.push({ id: "delete", label: "会話を削除", disabled: !can || snapshot.model.conversations.length <= 1, danger: true, onSelect: () => setDeleting({ kind: "conversation", id }) });
    showMenu(event, items);
  }
  function selectConversation(id: string) {
    const item = getAIChatConversation(session.getAIChat(), id); if (!item) return false;
    if (id === selectedRef.current) return true;
    session.cancel(); selectedRef.current = id; setSelectedId(id); clearTransientState();
    return true;
  }
  async function execute(command: AIChatCommand | readonly AIChatCommand[]) {
    const result = await session.execute(command);
    if (result && (Array.isArray(command) ? command : [command]).some(item => item.type === "aichat.replace")) { clearTransientState(); selectConversation(result.conversations[0].id); }
    return result;
  }
  async function importNative(input: string) { const result = await session.importNative(input); if (result) { clearTransientState(); selectConversation(result.conversations[0].id); } return result; }
  useImperativeHandle(ref, () => ({
    getAIChat: session.getAIChat, getAIChatConversation: () => getAIChatConversation(session.getAIChat(), selectedRef.current) ?? session.getAIChat().conversations[0], selectConversation,
    execute, send: (content, files) => session.send(selectedRef.current, content, files), retry: id => session.retry(selectedRef.current, id),
    cancel: session.cancel, save: session.save, undo: session.undo, redo: session.redo, discard: session.discard, importNative, exportNative: session.exportNative,
  }));
  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [conversation.id, conversation.messages]);
  async function submit() {
    const id = conversation.id, text = draft, files = attachments, version = composerVersion.current;
    if (await session.send(id, text, files) && selectedRef.current === id && version === composerVersion.current) { composerVersion.current++; setDraft(""); setAttachments([]); }
  }
  async function addConversation() {
    const id = crypto.randomUUID();
    if (await session.execute({ type: "conversation.add", id })) selectConversation(id);
  }
  async function uploadFiles(files: File[]) {
    const id = conversation.id, handler = props.onAttachmentUpload;
    const current = session.getSnapshot(), version = composerVersion.current;
    if (!handler || !files.length || !current.editable || !current.features.send || !current.features.attachments) return;
    if (attachments.length + files.length > AICHAT_LIMITS.metadataItems) { session.setNotice({ kind: "error", text: "添付ファイルは100件までです。先に不要な添付を外してください。" }); return; }
    const result = await session.prepareAttachments(async context => handler(files, context));
    if (result && selectedRef.current === id && version === composerVersion.current) {
      const combined = [...attachments, ...result];
      if (combined.length > AICHAT_LIMITS.metadataItems) { session.setNotice({ kind: "error", text: "添付ファイルは100件までです。追加されたファイルを確認してください。" }); return; }
      if (new Set(combined.map(item => item.id)).size !== combined.length) { session.setNotice({ kind: "error", text: "添付ファイルのIDが既存の添付と重複しています。" }); return; }
      composerVersion.current++; setAttachments(combined);
    }
  }
  async function importFile(file: File) {
    if (file.size > AICHAT_LIMITS.jsonBytes) { session.setNotice({ kind: "error", text: "JSONファイルが大きすぎます。" }); return; }
    const result = await session.prepare(async (_, context) => {
      const text = await file.text(); if (context.signal.aborted) throw new Error("読み込みを中止しました。");
      return { type: "aichat.replace", aichat: parseAIChat(text) };
    }, { feature: "import" });
    if (result) { clearTransientState(); selectConversation(result.conversations[0].id); }
  }
  function download() {
    const text = session.exportNative(); if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = props.exportFileName ?? "aichat.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function attachmentView(item: AIChatAttachment, removable = false) {
    return <span className="lxai-attachment" key={item.id}><Paperclip size={13} />{props.onAttachmentClick && !removable ? <button type="button" onClick={() => props.onAttachmentClick?.(item)}>{item.name}</button> : item.url && !removable ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : <span>{item.name}</span>}<small>{item.size < 1024 ? `${item.size} B` : `${Math.ceil(item.size / 1024)} KB`}</small>{removable && <button type="button" aria-label={`${item.name}を外す`} disabled={!can} onClick={() => { composerVersion.current++; setAttachments(current => current.filter(file => file.id !== item.id)); }}><X size={12} /></button>}</span>;
  }
  function messageView(message: AIChatMessage) {
    const streaming = snapshot.busy === "task" && activeResponse?.messageId === message.id;
    return <article className={`lxai-message lxai-message-${message.role}`} key={message.id} aria-label={`${roleNames[message.role]}のメッセージ`} onContextMenu={event => messageMenu(event, message)}>
      <div className={`lxai-avatar lxai-avatar-${message.role}`}>{message.role === "user" ? <UserRound size={17} /> : <Bot size={18} />}</div>
      <div className="lxai-message-main"><div className="lxai-message-meta"><strong>{roleNames[message.role]}</strong><time dateTime={message.createdAt}>{message.createdAt.slice(11, 16)} UTC</time>{streaming && <span className="lxai-stream-status"><LoaderCircle size={12} />生成中</span>}</div>
        <div className="lxai-message-content">{message.content || (streaming ? "応答を待っています…" : message.status === "complete" ? "（空のメッセージ）" : "")}</div>
        {!!message.attachments?.length && <div className="lxai-attachments">{message.attachments.map(item => attachmentView(item))}</div>}
        {!!message.references?.length && <div className="lxai-references"><span>参照</span>{message.references.map(item => <div key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : <strong>{item.title}</strong>}{item.description && <p>{item.description}</p>}</div>)}</div>}
        {!!message.toolCalls?.length && <div className="lxai-tools">{message.toolCalls.map(item => <details key={item.id}><summary><FileText size={13} />{item.name}<span>{toolNames[item.status]}</span></summary>{item.detail && <pre>{item.detail}</pre>}</details>)}</div>}
        {message.status === "error" && <p className="lxai-message-error">{message.error || "応答の生成に失敗しました。"}</p>}
        {(message.status === "cancelled" || message.status === "streaming" && !streaming) && <p className="lxai-interrupted">応答を停止しました</p>}
        <div className="lxai-message-actions">
          {flags.edit && <button type="button" disabled={!can} onClick={() => setEditing({ id: message.id, content: message.content })} aria-label="メッセージを編集"><Pencil size={13} /></button>}
          {flags.delete && <button type="button" disabled={!can} onClick={() => setDeleting({ kind: "message", id: message.id })} aria-label="メッセージを削除"><Trash2 size={13} /></button>}
          {flags.retry && flags.send && props.onSend && message.role === "assistant" && message.replyTo && <button type="button" disabled={!can} onClick={() => { void session.retry(conversation.id, message.id); }} aria-label="応答を再生成"><RefreshCw size={13} /><span>再生成</span></button>}
        </div>
      </div>
    </article>;
  }
  return <div data-likex-aichat="" data-color-mode={mode} className={`lxai-root ${props.className ?? ""}`} style={{ "--lxai-primary": palette.primary, "--lxai-on-primary": palette.onPrimary, "--lxai-accent": palette.accent, ...props.style } as CSSProperties}>
    <aside className="lxai-sidebar"><div className="lxai-brand"><span className="lxai-brand-icon"><MessageSquare size={19} /></span><strong>{props.title ?? snapshot.model.title}</strong></div>
      {flags.conversations && <button type="button" className="lxai-new-conversation" disabled={!can} onClick={() => { void addConversation(); }}><Plus size={16} />新しい会話</button>}
      <div className="lxai-sidebar-label">会話</div><nav aria-label="会話一覧">{snapshot.model.conversations.map(item => <div className={`lxai-conversation ${item.id === conversation.id ? "is-active" : ""}`} key={item.id} onContextMenu={event => conversationMenu(event, item.id, item.title)}><button type="button" aria-current={item.id === conversation.id ? "page" : undefined} onClick={() => selectConversation(item.id)}><MessageSquare size={15} /><span>{item.title}</span></button>{flags.conversations && <button type="button" className="lxai-conversation-menu" aria-label={`${item.title}の名前を変更`} disabled={!can} onClick={() => setRenaming({ id: item.id, title: item.title })}><Pencil size={12} /></button>}</div>)}</nav>
      <div className="lxai-sidebar-footer"><span className="lxai-status-dot" />{snapshot.readOnly ? "閲覧モード" : snapshot.dirty ? "未保存の変更" : "保存済み"}<small>{snapshot.model.conversations.length} 件の会話</small></div>
    </aside>
    <main className="lxai-main"><header className="lxai-header"><div><h2>{conversation.title}</h2><p>{props.onSend ? "アシスタントと会話する" : "メッセージを記録する"}</p></div><div className="lxai-header-actions">
      {flags.history && <><button type="button" aria-label="元に戻す" title="元に戻す" disabled={!can || !snapshot.canUndo} onClick={() => { void session.undo(); }}><Undo2 size={16} /></button><button type="button" aria-label="やり直す" title="やり直す" disabled={!can || !snapshot.canRedo} onClick={() => { void session.redo(); }}><Redo2 size={16} /></button></>}
      {flags.import && <button type="button" aria-label="JSONを読み込む" title="JSONを読み込む" disabled={!can} onClick={() => importRef.current?.click()}><Upload size={16} /></button>}
      {flags.export && <button type="button" aria-label="JSONを書き出す" title="JSONを書き出す" onClick={download}><ArrowDownToLine size={16} /></button>}
      {!snapshot.readOnly && <button type="button" className="lxai-save" disabled={!can || !snapshot.dirty} onClick={() => { void session.save(); }}><Save size={15} /><span>保存</span></button>}
    </div></header>
    {snapshot.notice && <div className={`lxai-notice lxai-notice-${snapshot.notice.kind}`} role={snapshot.notice.kind === "error" ? "alert" : "status"}>{snapshot.notice.text}<button type="button" aria-label="通知を閉じる" onClick={() => session.setNotice(null)}><X size={14} /></button></div>}
    <div className="lxai-transcript" ref={transcriptRef} role="log" aria-label="メッセージ" aria-live="polite" aria-relevant="additions text">{conversation.messages.length ? conversation.messages.map(messageView) : <div className="lxai-empty"><div><MessageSquare size={30} /></div><h3>ここから、会話を始めましょう</h3><p>アイデアや質問を入力して、新しい会話を作成できます。</p></div>}</div>
    {flags.send && <footer className="lxai-composer-area"><form className="lxai-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      {!!attachments.length && <div className="lxai-attachments">{attachments.map(item => attachmentView(item, true))}</div>}
      <textarea aria-label="メッセージを入力" placeholder={snapshot.readOnly ? "このチャットは閲覧専用です" : "メッセージを入力…"} value={draft} maxLength={AICHAT_LIMITS.contentLength} disabled={!can || !flags.send} onChange={event => { composerVersion.current++; setDraft(event.target.value); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (can && flags.send) void submit(); } }} rows={2} />
      <div className="lxai-composer-controls"><div>{flags.attachments && props.onAttachmentUpload && <button type="button" className="lxai-attach-button" disabled={!can || !flags.send} aria-label="ファイルを添付" onClick={() => uploadRef.current?.click()}><Paperclip size={17} /><span>添付</span></button>}</div><div><span className="lxai-keyboard-hint">Shift + Enter で改行</span>{snapshot.busy === "task" ? <button type="button" className="lxai-send" aria-label="応答を停止" onClick={session.cancel}><Square size={15} fill="currentColor" /></button> : <button type="submit" className="lxai-send" disabled={!can || !flags.send || !draft.trim() && !attachments.length} aria-label="送信"><ArrowUp size={19} /></button>}</div></div>
    </form><p className="lxai-composer-note">{snapshot.busy === "permission" ? "編集許可を確認しています…" : snapshot.busy === "save" ? "保存しています…" : "メッセージと添付ファイルは、このアプリの設定に従って処理されます。"}</p></footer>}
    </main>
    <input ref={uploadRef} type="file" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void uploadFiles(files); }} />
    <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} />
    {(editing || renaming || deleting) && <div className="lxai-dialog-backdrop"><section className="lxai-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogId} onKeyDown={event => { if (event.key === "Escape") { setEditing(null); setRenaming(null); setDeleting(null); } }}><h3 id={dialogId}>{editing ? "メッセージを編集" : renaming ? "会話の名前" : "削除の確認"}</h3>
      {editing && <textarea autoFocus aria-label="メッセージ本文" rows={7} value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} />}
      {renaming && <input autoFocus aria-label="会話の名前" value={renaming.title} maxLength={1000} onChange={event => setRenaming({ ...renaming, title: event.target.value })} />}
      {deleting && <p>{deleting.kind === "message" ? "このメッセージと、それに返信したメッセージを削除します。" : "この会話のすべてのメッセージを削除します。"}</p>}
      <div className="lxai-dialog-actions">{renaming && flags.delete && snapshot.model.conversations.length > 1 && <button type="button" className="lxai-danger" disabled={!can} onClick={() => { setDeleting({ kind: "conversation", id: renaming.id }); setRenaming(null); }}><Trash2 size={14} />会話を削除</button>}<button type="button" onClick={() => { setEditing(null); setRenaming(null); setDeleting(null); }}>キャンセル</button><button type="button" className="lxai-primary-button" disabled={!can || !!renaming && !renaming.title.trim()} onClick={() => {
        if (editing) void session.execute({ type: "message.update", conversationId: conversation.id, messageId: editing.id, patch: { content: editing.content } }).then(result => { if (result) setEditing(null); });
        else if (renaming) void session.execute({ type: "conversation.update", conversationId: renaming.id, title: renaming.title }).then(result => { if (result) setRenaming(null); });
        else if (deleting) void session.execute(deleting.kind === "message" ? { type: "message.delete", conversationId: conversation.id, messageId: deleting.id, cascadeReplies: true } : { type: "conversation.delete", conversationId: deleting.id }).then(result => { if (result) setDeleting(null); });
      }}>{deleting ? <Trash2 size={14} /> : <Check size={14} />}{deleting ? "削除" : "適用"}</button></div>
    </section></div>}
  </div>;
});
