"use client";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ForwardRefExoticComponent, MouseEvent, PropsWithoutRef, RefAttributes } from "react";
import { ArrowDownToLine, CheckCheck, ChevronDown, Hash, Home, Inbox, LoaderCircle, Menu, MessageCircle, MessageSquare, Plus, Redo2, Save, Search, Undo2, Upload, Users, X } from "lucide-react";
import { createPrimaryColorPalette } from "./core";
import { openContextMenu, type ContextMenuAction } from "./browser";
import { CHAT_LIMITS, createChat, getConversation, getUnreadCount } from "./model";
import type { ChatCommand, ChatConversation, ChatMessage } from "./model";
import type { ChatHandle, ChatProps } from "./chat-types";
import { createChatSession } from "./state/session";
import { ChatAvatar } from "./ui/chat-avatar";
import { ChatComposer } from "./ui/chat-composer";
import type { ChatDraft } from "./ui/chat-composer";
import { ChatDialog } from "./ui/chat-dialog";
import { ChatMessageItem } from "./ui/chat-message";

const emptyDraft: ChatDraft = { text: "", attachments: [] };
export const LikeChat: ForwardRefExoticComponent<PropsWithoutRef<ChatProps> & RefAttributes<ChatHandle>> = forwardRef<ChatHandle, ChatProps>(function LikeChat(props, ref) {
  const [session] = useState(() => createChatSession(props.initialChat ?? createChat(), props));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useLayoutEffect(() => { session.configure(props); });
  useEffect(() => { session.activate(); return () => session.dispose(); }, [session]);
  const { model, features: flags, editable: can } = snapshot;
  const visible = model.conversations.filter(item => item.memberIds.includes(props.currentUserId));
  const [selectedId, setSelectedId] = useState(props.initialConversationId ?? visible[0]?.id);
  const conversation = visible.find(item => item.id === selectedId) ?? visible[0];
  const [home, setHome] = useState(false), [unreadOnly, setUnreadOnly] = useState(false), [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false), [threadId, setThreadId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const [editing, setEditing] = useState<{ conversationId: string; id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<{ conversationId: string; id: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deletingConversation, setDeletingConversation] = useState<string | null>(null);
  const [creating, setCreating] = useState(false), [newKind, setNewKind] = useState<"direct" | "space">("direct"), [newTitle, setNewTitle] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const root = useRef<HTMLDivElement>(null), transcript = useRef<HTMLDivElement>(null), threadTranscript = useRef<HTMLDivElement>(null), importInput = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true), previousConversation = useRef<string | undefined>(undefined);
  const menuCleanup = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const threadNearBottom = useRef(true), previousThread = useRef<string | undefined>(undefined);
  const target = useRef(conversation?.id); target.current = conversation?.id;
  const onConversationChange = useRef(props.onConversationChange); onConversationChange.current = props.onConversationChange;
  const conversationId = conversation?.id;
  useEffect(() => { menuCleanup.current?.(); menuCleanup.current = null; }, [snapshot, conversationId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; menuCleanup.current?.(); }; }, []);
  useEffect(() => {
    const selected = conversationId && getConversation(session.getChat(), conversationId);
    if (selected) { try { onConversationChange.current?.(selected); } catch { /* Observer only. */ } }
  }, [session, model.id, conversationId]);
  useEffect(() => {
    const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
    if (!media) return;
    const update = () => setDark(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const node = transcript.current;
    if (node && (nearBottom.current || previousConversation.current !== conversation?.id)) node.scrollTop = node.scrollHeight;
    previousConversation.current = conversation?.id;
  }, [conversation?.id, conversation?.messages, home, query]);
  const mode = props.colorMode === "dark" || props.colorMode === "system" && dark ? "dark" : "light";
  const palette = createPrimaryColorPalette(props.primaryColor, mode) ?? createPrimaryColorPalette(mode === "dark" ? "#a8c7fa" : "#0b57d0", mode)!;
  function selectConversation(id: string) {
    const item = getConversation(session.getChat(), id);
    if (!item || !item.memberIds.includes(props.currentUserId)) return false;
    if (target.current !== id || threadId !== null) session.cancel();
    target.current = id; setSelectedId(id); setHome(false); setQuery(""); setSidebarOpen(false); setThreadId(null); setEditing(null); setDeleting(null); nearBottom.current = true;
    return true;
  }
  function resetDraftsAndDialogs() { setDrafts({}); setEditing(null); setDeleting(null); setRenaming(null); setDeletingConversation(null); setThreadId(null); setCreating(false); setMembers([]); setNewTitle(""); }
  async function execute(command: ChatCommand | readonly ChatCommand[]) {
    const result = await session.execute(command);
    const commands = Array.isArray(command) ? command : [command];
    if (result && commands.some(item => item.type === "chat.replace")) resetDraftsAndDialogs();
    return result;
  }
  async function importNative(input: string) { const result = await session.importNative(input); if (result) resetDraftsAndDialogs(); return result; }
  const syncChat: ChatHandle["syncChat"] = (chat, settings) => { const result = session.syncChat(chat, settings); if (result) resetDraftsAndDialogs(); return result; };
  function selectThread(id: string | null) { if (id !== threadId) session.cancel(); setThreadId(id); }
  useImperativeHandle(ref, () => ({
    getChat: session.getChat, getConversation: () => target.current ? getConversation(session.getChat(), target.current) : undefined, selectConversation, execute,
    send: (text, files, replyTo) => target.current ? session.send(target.current, text, files, replyTo) : Promise.resolve(false),
    cancel: session.cancel, save: session.save, undo: session.undo, redo: session.redo, discard: session.discard,
    importNative, exportNative: session.exportNative, syncChat,
  }));
  const person = (id: string) => model.participants.find(item => item.id === id);
  const currentUser = person(props.currentUserId);
  const peer = (item: ChatConversation) => person(item.memberIds.find(id => id !== props.currentUserId) ?? props.currentUserId);
  const displayTitle = (item: ChatConversation) => item.kind === "direct" ? peer(item)?.name ?? item.title : item.title;
  function showMenu(event: MouseEvent<HTMLElement>, items: ContextMenuAction[]) {
    if (!items.length || event.shiftKey || (event.target as HTMLElement).closest?.('input,textarea,[contenteditable]:not([contenteditable="false"]),a')) return;
    event.preventDefault(); event.stopPropagation(); menuCleanup.current?.();
    const before = session.getSnapshot(), selected = target.current;
    menuCleanup.current = openContextMenu({ anchor: event.currentTarget, x: event.clientX, y: event.clientY,
      items: items.map(item => ({ ...item, onSelect: () => mounted.current && session.getSnapshot() === before && target.current === selected ? item.onSelect() : undefined })),
      onError: cause => session.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "操作できませんでした。" }),
    });
  }
  function copyText(anchor: HTMLElement, text: string) {
    const clipboard = anchor.ownerDocument.defaultView?.navigator.clipboard;
    if (!clipboard?.writeText) throw new Error("この環境ではテキストをコピーできません。");
    return clipboard.writeText(text);
  }
  function messageMenu(event: MouseEvent<HTMLElement>, message: ChatMessage) {
    if (!conversation) return;
    const id = conversation.id, own = message.authorId === props.currentUserId, anchor = event.currentTarget;
    const items: ContextMenuAction[] = [{ id: "copy", label: "テキストをコピー", disabled: !message.text, onSelect: () => copyText(anchor, message.text) }];
    if (flags.threads) items.push({ id: "reply", label: can && flags.send ? "スレッドで返信" : "スレッドを開く", onSelect: () => selectThread(message.replyTo ?? message.id) });
    if (flags.reactions) items.push({ id: "reaction", label: "👍 リアクションを切り替え", disabled: !can, onSelect: () => execute({ type: "reaction.toggle", conversationId: id, messageId: message.id, participantId: props.currentUserId, emoji: "👍" }) });
    if (own && flags.edit) items.push({ id: "edit", label: "メッセージを編集", disabled: !can, separatorBefore: true, onSelect: () => setEditing({ conversationId: id, id: message.id, text: message.text }) });
    if (own && flags.delete) items.push({ id: "delete", label: "メッセージを削除", disabled: !can, danger: true, onSelect: () => setDeleting({ conversationId: id, id: message.id }) });
    showMenu(event, items);
  }
  function conversationMenu(event: MouseEvent<HTMLElement>, item: ChatConversation) {
    const items: ContextMenuAction[] = [{ id: "open", label: "会話を開く", onSelect: () => selectConversation(item.id) }];
    const last = item.messages.at(-1);
    if (flags.read) items.push({ id: "read", label: "既読にする", disabled: !can || !last || !getUnreadCount(model, item.id, props.currentUserId), onSelect: () => last && execute({ type: "conversation.read", conversationId: item.id, participantId: props.currentUserId, messageId: last.id }) });
    if (flags.conversations && item.kind !== "direct") items.push({ id: "rename", label: "会話名を変更", disabled: !can, separatorBefore: true, onSelect: () => setRenaming({ id: item.id, title: item.title }) });
    if (flags.conversations && flags.delete) items.push({ id: "delete", label: "会話を削除", disabled: !can, danger: true, onSelect: () => setDeletingConversation(item.id) });
    showMenu(event, items);
  }
  const activeThread = flags.threads && threadId ? conversation?.messages.find(item => item.id === threadId && !item.replyTo) : undefined;
  useLayoutEffect(() => {
    const node = threadTranscript.current;
    if (node && (threadNearBottom.current || previousThread.current !== activeThread?.id)) node.scrollTop = node.scrollHeight;
    previousThread.current = activeThread?.id;
  }, [activeThread?.id, conversation?.messages]);
  const search = flags.search ? query.trim().toLocaleLowerCase() : "";
  const filterUnread = flags.read && unreadOnly;
  const overview = home || !conversation || !!search;
  const messages = conversation?.messages.filter(message => !message.replyTo) ?? [];
  function renderMessage(message: ChatMessage, inThread = false) {
    return <ChatMessageItem key={message.id} message={message} person={person(message.authorId)} own={message.authorId === props.currentUserId} currentUserId={props.currentUserId}
      onContextMenu={event => messageMenu(event, message)}
      canEdit={can && flags.edit && message.authorId === props.currentUserId} canDelete={can && flags.delete && message.authorId === props.currentUserId} canReact={can && flags.reactions} showReactions={flags.reactions}
      showThreads={flags.threads && !inThread} replyCount={conversation?.messages.filter(item => item.replyTo === message.id).length}
      onReply={() => selectThread(message.id)} onEdit={() => { if (conversation) setEditing({ conversationId: conversation.id, id: message.id, text: message.text }); }}
      onDelete={() => { if (conversation) setDeleting({ conversationId: conversation.id, id: message.id }); }}
      onReaction={emoji => { if (conversation) void execute({ type: "reaction.toggle", conversationId: conversation.id, messageId: message.id, participantId: props.currentUserId, emoji }); }} onAttachmentClick={props.onAttachmentClick} />;
  }
  function composer(replyTo?: string) {
    if (!conversation || !flags.send) return null;
    const id = conversation.id, key = JSON.stringify([model.id, props.currentUserId, id, replyTo ?? null]);
    return <ChatComposer key={key} draft={drafts[key] ?? emptyDraft} onDraft={draft => setDrafts(current => ({ ...current, [key]: draft }))}
      disabled={snapshot.readOnly} busy={snapshot.busy !== null} label={snapshot.readOnly ? "このチャットは閲覧専用です" : replyTo ? "スレッドに返信" : `${displayTitle(conversation)} にメッセージ`}
      canAttach={flags.attachments && !!props.onAttachmentUpload}
      onUpload={async files => {
        const result = await session.prepareAttachments(context => Promise.resolve(props.onAttachmentUpload!(files, context)));
        if (!result) return null;
        const combined = [...(drafts[key]?.attachments ?? []), ...result];
        if (combined.length > CHAT_LIMITS.metadataItems || new Set(combined.map(item => item.id)).size !== combined.length) {
          session.setNotice({ kind: "error", text: "添付ファイルは重複しないIDで100件まで追加できます。" }); return null;
        }
        return result;
      }}
      onSend={draft => { if (replyTo) threadNearBottom.current = true; else nearBottom.current = true; return session.send(id, draft.text, draft.attachments, replyTo); }} />;
  }
  async function newConversation() {
    if (!members.length || newKind === "space" && !newTitle.trim()) return;
    const id = crypto.randomUUID();
    const others = members.filter(id => id !== props.currentUserId);
    if (!others.length) return;
    const result = await execute({ type: "conversation.add", id, kind: newKind === "direct" && others.length > 1 ? "group" : newKind, title: newKind === "space" ? newTitle.trim() : others.map(id => person(id)?.name ?? id).join(", "), memberIds: [props.currentUserId, ...others] });
    if (result) { setCreating(false); setNewTitle(""); setMembers([]); selectConversation(id); }
  }
  async function importFile(file: File) {
    if (file.size > CHAT_LIMITS.jsonBytes) { session.setNotice({ kind: "error", text: "JSONファイルが大きすぎます。" }); return; }
    const before = session.getSnapshot().model, selected = target.current;
    try {
      const text = await file.text();
      if (!root.current || session.getSnapshot().model !== before || target.current !== selected) return;
      await importNative(text);
    } catch (error) { session.setNotice({ kind: "error", text: error instanceof Error ? error.message : "読み込めませんでした。" }); }
  }
  function exportFile() {
    const text = session.exportNative(); if (!text) return;
    const doc = root.current?.ownerDocument; if (!doc) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" })), anchor = doc.createElement("a");
    anchor.href = url; anchor.download = props.exportFileName ?? "chat.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const deleteReplies = deleting ? model.conversations.find(item => item.id === deleting.conversationId)?.messages.filter(item => item.replyTo === deleting.id).length ?? 0 : 0;
  function navigationGroup(title: string, entries: ChatConversation[]) {
    return <section className="lxh-nav-section"><h2><ChevronDown size={15} />{title}</h2>{entries.map(item => {
      const unread = flags.read ? getUnreadCount(model, item.id, props.currentUserId) : 0;
      return <button type="button" className={`lxh-conversation${!home && item.id === conversation?.id ? " is-active" : ""}${unread ? " is-unread" : ""}`} key={item.id} onClick={() => selectConversation(item.id)} onContextMenu={event => conversationMenu(event, item)} aria-current={!home && item.id === conversation?.id ? "page" : undefined}>
        {item.kind === "direct" ? <ChatAvatar person={peer(item)} small /> : <span className="lxh-space-icon">{item.kind === "space" ? <Hash size={16} /> : <Users size={16} />}</span>}<span>{displayTitle(item)}</span>{unread > 0 && <small className="lxh-unread-count">{unread > 99 ? "99+" : unread}</small>}
      </button>;
    })}</section>;
  }
  return <div ref={root} data-likex-chat="" data-color-mode={mode} className={`lxh-root ${props.className ?? ""}`} style={{ "--lxh-primary": palette.primary, "--lxh-on-primary": palette.onPrimary, "--lxh-accent": palette.selection, "--lxh-ink": palette.accent, ...props.style } as CSSProperties}>
    <header className="lxh-topbar"><div className="lxh-brand"><button type="button" className="lxh-menu-button" aria-label="会話一覧を切り替え" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}><Menu size={20} /></button><MessageCircle className="lxh-brand-mark" size={28} /><strong>{props.title ?? model.title}</strong></div>
      {flags.search && <label className="lxh-search"><Search size={20} /><input type="search" aria-label="チャットを検索" placeholder="チャットを検索" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="検索をクリア" onClick={() => setQuery("")}><X size={16} /></button>}</label>}
      <div className="lxh-top-actions">{snapshot.busy && <button type="button" onClick={session.cancel} aria-label="処理を中止" title="処理を中止"><LoaderCircle className="lxh-spin" size={17} /><X size={12} /></button>}
        {flags.history && <><button type="button" title="元に戻す" aria-label="元に戻す" disabled={!can || !snapshot.canUndo} onClick={() => { void session.undo(); }}><Undo2 size={17} /></button><button type="button" title="やり直す" aria-label="やり直す" disabled={!can || !snapshot.canRedo} onClick={() => { void session.redo(); }}><Redo2 size={17} /></button></>}
        {flags.import && <><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importFile(file); }} /><button type="button" title="JSONを読み込む" aria-label="JSONを読み込む" disabled={!can} onClick={() => importInput.current?.click()}><Upload size={17} /></button></>}
        {flags.export && <button type="button" title="JSONを書き出す" aria-label="JSONを書き出す" onClick={exportFile}><ArrowDownToLine size={17} /></button>}
        {!snapshot.readOnly && props.onSave && <button type="button" className="lxh-save" disabled={!can || !snapshot.dirty} onClick={() => { void session.save(); }}><Save size={16} /><span>保存</span></button>}<ChatAvatar person={currentUser} />
      </div></header>
    <div className="lxh-workspace"><aside className={`lxh-sidebar${sidebarOpen ? " is-open" : ""}`} aria-label="チャットのナビゲーション">
      {flags.conversations && <button type="button" className="lxh-new-chat" disabled={!can} onClick={() => setCreating(true)}><Plus size={22} />新しいチャット</button>}
      <nav aria-label="ショートカット"><button type="button" className={home && !filterUnread ? "is-active" : ""} onClick={() => { setHome(true); setUnreadOnly(false); setSidebarOpen(false); setQuery(""); }}><Home size={19} />ホーム</button>{flags.read && <button type="button" className={home && filterUnread ? "is-active" : ""} onClick={() => { setHome(true); setUnreadOnly(true); setSidebarOpen(false); setQuery(""); }}><Inbox size={19} />未読<span>{visible.reduce((sum, item) => sum + getUnreadCount(model, item.id, props.currentUserId), 0) || ""}</span></button>}</nav>
      <div className="lxh-nav-scroll">{navigationGroup("ダイレクト メッセージ", visible.filter(item => item.kind !== "space"))}{navigationGroup("スペース", visible.filter(item => item.kind === "space"))}</div>
      <div className="lxh-sidebar-footer"><span className="lxh-online-dot" />{currentUser?.name ?? "閲覧者"}<span>{currentUser?.status === "away" ? "離席中" : currentUser?.status === "online" ? "オンライン" : "オフライン"}</span></div>
    </aside>
    {sidebarOpen && <button className="lxh-sidebar-backdrop" type="button" aria-label="会話一覧を閉じる" onClick={() => setSidebarOpen(false)} />}
    <main className="lxh-main">
      {snapshot.notice && <div className={`lxh-notice lxh-notice-${snapshot.notice.kind}`} role={snapshot.notice.kind === "error" ? "alert" : "status"}>{snapshot.notice.text}<button type="button" aria-label="通知を閉じる" onClick={() => session.setNotice(null)}><X size={14} /></button></div>}
      {overview ? <section className="lxh-overview"><header><h1>{search ? `「${query.trim()}」の検索結果` : filterUnread ? "未読のチャット" : "ホーム"}</h1><p>{search ? "会話名とメッセージから検索" : "チームの会話を、ここから。"}</p></header><div className="lxh-overview-list">{visible.filter(item => !filterUnread || !home || getUnreadCount(model, item.id, props.currentUserId) > 0).map(item => {
        const found = search ? item.messages.filter(message => message.text.toLocaleLowerCase().includes(search)) : [];
        if (search && !displayTitle(item).toLocaleLowerCase().includes(search) && !found.length) return null;
        const last = found[0] ?? item.messages.at(-1);
        return <button key={item.id} type="button" onClick={() => { selectConversation(item.id); if (last?.replyTo) setThreadId(last.replyTo); }} onContextMenu={event => conversationMenu(event, item)} className="lxh-overview-card">{item.kind === "direct" ? <ChatAvatar person={peer(item)} /> : <span className="lxh-space-icon"><Hash size={22} /></span>}<span><strong>{displayTitle(item)}</strong><small>{last ? `${person(last.authorId)?.name ?? ""}: ${last.text || "添付ファイル"}` : "メッセージはまだありません"}</small></span>{search && found.length > 0 ? <em>{found.length}件</em> : flags.read && getUnreadCount(model, item.id, props.currentUserId) > 0 ? <i className="lxh-unread-dot" /> : null}</button>;
      })}{!visible.some(item => (!home || !filterUnread || getUnreadCount(model, item.id, props.currentUserId) > 0) && (!search || displayTitle(item).toLocaleLowerCase().includes(search) || item.messages.some(message => message.text.toLocaleLowerCase().includes(search)))) && <div className="lxh-empty"><MessageSquare size={32} /><p>{search ? "一致するチャットはありません" : "表示するチャットはありません"}</p></div>}</div></section> : <>
        <header className="lxh-conversation-header"><div className="lxh-conversation-heading">{conversation.kind === "direct" ? <ChatAvatar person={peer(conversation)} /> : <span className="lxh-space-icon"><Hash size={22} /></span>}<div><h1>{displayTitle(conversation)}</h1><p>{conversation.kind === "space" ? "スペース" : conversation.kind === "group" ? "グループチャット" : peer(conversation)?.status === "online" ? "オンライン" : "ダイレクト メッセージ"}<span> · {conversation.memberIds.length} 人のメンバー</span></p></div></div>{flags.read && <button type="button" disabled={!can || !getUnreadCount(model, conversation.id, props.currentUserId)} title="既読にする" aria-label="既読にする" onClick={() => { const last = conversation.messages.at(-1); if (last) void execute({ type: "conversation.read", conversationId: conversation.id, participantId: props.currentUserId, messageId: last.id }); }}><CheckCheck size={20} /></button>}</header>
        <div className="lxh-conversation-layout"><div className="lxh-conversation-main"><div ref={transcript} className="lxh-transcript" role="log" aria-label="メッセージ" aria-live="polite" onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
          <div className="lxh-conversation-intro"><span className="lxh-intro-icon">{conversation.kind === "space" ? <Hash size={28} /> : <MessageCircle size={28} />}</span><h2>{displayTitle(conversation)}</h2><p>{conversation.kind === "space" ? "情報を共有して、一緒に進めましょう" : "ここから会話が始まります"}</p></div>
          {messages.map((message, index) => <div key={message.id}>{(!index || new Date(messages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <div className="lxh-date-divider"><span>{new Date(message.createdAt).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}</span></div>}{renderMessage(message)}</div>)}
        </div><div className="lxh-composer-area">{composer()}</div></div>
        {activeThread && <aside className="lxh-thread" aria-label="スレッド"><header><h2>スレッド</h2><button type="button" aria-label="スレッドを閉じる" onClick={() => selectThread(null)}><X size={19} /></button></header><div ref={threadTranscript} className="lxh-thread-messages" role="log" aria-label="スレッドのメッセージ" onScroll={event => { const node = event.currentTarget; threadNearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>{renderMessage(activeThread, true)}<div className="lxh-thread-divider">{conversation.messages.filter(item => item.replyTo === activeThread.id).length} 件の返信</div>{conversation.messages.filter(item => item.replyTo === activeThread.id).map(message => renderMessage(message, true))}</div><div className="lxh-composer-area">{composer(activeThread.id)}</div></aside>}
        </div></>}
    </main></div>
    {creating && flags.conversations && <ChatDialog title="新しいチャット" onClose={() => setCreating(false)}><form onSubmit={event => { event.preventDefault(); void newConversation(); }}><label>種類<select value={newKind} onChange={event => setNewKind(event.target.value as "direct" | "space")}><option value="direct">ダイレクト メッセージ</option><option value="space">スペース</option></select></label>{newKind === "space" && <label>スペース名<input value={newTitle} required maxLength={200} onChange={event => setNewTitle(event.target.value)} placeholder="例: デザインチーム" /></label>}<fieldset><legend>メンバー</legend>{model.participants.filter(item => item.id !== props.currentUserId).map(item => <label className="lxh-member-choice" key={item.id}><input type="checkbox" checked={members.includes(item.id)} onChange={event => setMembers(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><ChatAvatar person={item} small /><span>{item.name}</span></label>)}</fieldset><footer><button type="button" onClick={() => setCreating(false)}>キャンセル</button><button type="submit" className="lxh-primary" disabled={!can || !members.length || newKind === "space" && !newTitle.trim()}>作成</button></footer></form></ChatDialog>}
    {editing && flags.edit && model.conversations.find(item => item.id === editing.conversationId)?.messages.some(item => item.id === editing.id && item.authorId === props.currentUserId) && <ChatDialog title="メッセージを編集" onClose={() => setEditing(null)}><form onSubmit={event => { event.preventDefault(); void execute({ type: "message.update", conversationId: editing.conversationId, messageId: editing.id, patch: { text: editing.text } }).then(result => { if (result) setEditing(null); }); }}><label>メッセージ<textarea rows={5} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} /></label><footer><button type="button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" className="lxh-primary" disabled={!can || !editing.text.trim()}>更新</button></footer></form></ChatDialog>}
    {deleting && flags.delete && model.conversations.find(item => item.id === deleting.conversationId)?.messages.some(item => item.id === deleting.id && item.authorId === props.currentUserId) && <ChatDialog title="メッセージを削除しますか？" onClose={() => setDeleting(null)}><p>{deleteReplies ? `このメッセージと、スレッド内の ${deleteReplies} 件の返信を削除します。` : "選択したメッセージを削除します。"}</p><footer><button type="button" onClick={() => setDeleting(null)}>キャンセル</button><button type="button" className="lxh-danger" disabled={!can} onClick={() => { void execute({ type: "message.delete", conversationId: deleting.conversationId, messageId: deleting.id, cascadeReplies: true }).then(result => { if (result) setDeleting(null); }); }}>削除</button></footer></ChatDialog>}
    {renaming && flags.conversations && <ChatDialog title="会話名を変更" onClose={() => setRenaming(null)}><form onSubmit={event => { event.preventDefault(); void execute({ type: "conversation.update", conversationId: renaming.id, title: renaming.title.trim() }).then(result => { if (result) setRenaming(null); }); }}><label>会話名<input value={renaming.title} maxLength={1000} onChange={event => setRenaming({ ...renaming, title: event.target.value })} /></label><footer><button type="button" onClick={() => setRenaming(null)}>キャンセル</button><button type="submit" className="lxh-primary" disabled={!can || !renaming.title.trim()}>更新</button></footer></form></ChatDialog>}
    {deletingConversation && flags.conversations && flags.delete && <ChatDialog title="会話を削除しますか？" onClose={() => setDeletingConversation(null)}><p>この会話とすべてのメッセージを削除します。</p><footer><button type="button" onClick={() => setDeletingConversation(null)}>キャンセル</button><button type="button" className="lxh-danger" disabled={!can} onClick={() => { void execute({ type: "conversation.delete", conversationId: deletingConversation }).then(result => { if (result) setDeletingConversation(null); }); }}>削除</button></footer></ChatDialog>}
  </div>;
});
