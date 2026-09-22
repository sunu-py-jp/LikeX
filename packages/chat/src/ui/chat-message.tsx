import { useState, type MouseEvent } from "react";
import { FileText, MessageSquare, Pencil, SmilePlus, Trash2 } from "lucide-react";
import type { ChatAttachment, ChatMessage, ChatParticipant } from "../model";
import { ChatAvatar } from "./chat-avatar";
export function ChatMessageItem({ message, person, own, canEdit, canDelete, canReact, showReactions, showThreads, replyCount = 0, currentUserId, onReply, onEdit, onDelete, onReaction, onAttachmentClick, onContextMenu }: {
  message: ChatMessage; person?: ChatParticipant; own: boolean; canEdit: boolean; canDelete: boolean; canReact: boolean; showReactions: boolean; showThreads: boolean; replyCount?: number; currentUserId: string;
  onReply(): void; onEdit(): void; onDelete(): void; onReaction(emoji: string): void; onAttachmentClick?: (attachment: ChatAttachment) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const [emojiPicker, setEmojiPicker] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return <article className={`lxh-message${own ? " is-own" : ""}`} aria-label={`${person?.name ?? "参加者"}のメッセージ`} onContextMenu={onContextMenu}>
    <ChatAvatar person={person} />
    <div className="lxh-message-body"><div className="lxh-message-meta"><strong>{person?.name ?? "参加者"}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString("ja-JP")}>{time}</time>{message.editedAt && <span>編集済み</span>}</div>
      <div className="lxh-message-text">{message.text}</div>
      {!!message.attachments?.length && <div className="lxh-attachments">{message.attachments.map(file => <div className="lxh-attachment" key={file.id}><FileText size={23} /><div>{onAttachmentClick ? <button type="button" onClick={() => onAttachmentClick(file)}>{file.name}</button> : file.url ? <a href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a> : <span>{file.name}</span>}<small>{file.size < 1024 ? `${file.size} B` : `${Math.ceil(file.size / 1024)} KB`}</small></div></div>)}</div>}
      {showReactions && !!message.reactions?.length && <div className="lxh-reactions">{message.reactions.map(reaction => <button key={reaction.emoji} type="button" disabled={!canReact} aria-label={`${reaction.emoji} ${reaction.participantIds.length}件のリアクション`} aria-pressed={reaction.participantIds.includes(currentUserId)} onClick={() => onReaction(reaction.emoji)}>{reaction.emoji}<span>{reaction.participantIds.length}</span></button>)}</div>}
      {showThreads && replyCount > 0 && <button type="button" className="lxh-thread-link" onClick={onReply}><MessageSquare size={14} />{replyCount} 件の返信<span>スレッドを開く</span></button>}
    </div>
    {(canReact || showThreads || canEdit || canDelete) && <div className="lxh-message-actions">
      {canReact && <button type="button" title="リアクションを追加" aria-label="リアクションを追加" aria-expanded={emojiPicker} onClick={() => setEmojiPicker(value => !value)}><SmilePlus size={16} /></button>}
      {showThreads && <button type="button" title="スレッドで返信" aria-label="スレッドで返信" onClick={onReply}><MessageSquare size={16} /></button>}
      {canEdit && <button type="button" title="メッセージを編集" aria-label="メッセージを編集" onClick={onEdit}><Pencil size={16} /></button>}
      {canDelete && <button type="button" title="メッセージを削除" aria-label="メッセージを削除" onClick={onDelete}><Trash2 size={16} /></button>}
      {emojiPicker && canReact && <div className="lxh-emoji-picker" role="group" aria-label="リアクション" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setEmojiPicker(false); } }}>{["👍", "❤️", "🎉", "👀", "✅"].map(emoji => <button type="button" key={emoji} aria-label={`${emoji}を付ける`} onClick={() => { onReaction(emoji); setEmojiPicker(false); }}>{emoji}</button>)}</div>}
    </div>}
  </article>;
}
