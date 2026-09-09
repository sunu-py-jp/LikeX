"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { cellAddress, SPREADSHEET_LIMITS, type SpreadsheetComment } from "../model";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { useObjectEditPending } from "../state/use-object-edit-pending";
import { Command, Icon } from "./spreadsheet-controls";

export function SpreadsheetComments({ controller: c }: { controller: SpreadsheetController }) {
  if (!c.features.comments || !c.commentOpen) return null;
  return <CommentsPanel controller={c} />;
}

function CommentsPanel({ controller: c }: { controller: SpreadsheetController }) {
  const panel = useRef<HTMLElement>(null);
  const address = cellAddress(c.selection.focus.row, c.selection.focus.column);
  const comment = c.activeSheet.comments?.[address];
  useLayoutEffect(() => { (panel.current?.querySelector<HTMLTextAreaElement>("textarea") ?? panel.current?.querySelector<HTMLButtonElement>("button"))?.focus(); }, []);
  return <aside ref={panel} className="lxs-comments" aria-label="セルのコメント" onCopy={event => event.stopPropagation()} onCut={event => event.stopPropagation()} onPaste={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); c.cancelEditRequest(); c.setCommentOpen(false); c.requestGridFocus(); } }}>
    <div className="lxs-object-heading"><strong>{address} のコメント</strong><Command label="コメントを閉じる" onClick={() => { c.cancelEditRequest(); c.setCommentOpen(false); c.requestGridFocus(); }}><Icon name="close" /></Command></div>
    <CommentEditor key={JSON.stringify([c.activeSheet.id, address, comment?.id, comment?.text, comment?.author, c.readOnly])} controller={c} address={address} comment={comment} />
  </aside>;
}

function CommentEditor({ controller: c, address, comment }: { controller: SpreadsheetController; address: string; comment?: SpreadsheetComment }) {
  const inputId = useId();
  const [text, setText] = useState(comment?.text ?? "");
  const starting = useRef(comment);
  const cancelled = useRef(false);
  const markPending = useObjectEditPending(c);
  const commit = (onSuccess?: () => void) => {
    if (cancelled.current || c.disabled || c.requesting || !c.features.comments || comment !== starting.current) return;
    const accepted = () => { markPending(false); onSuccess?.(); };
    if (text === (comment?.text ?? "")) accepted();
    else c.afterCommand({ type: "comments.set", sheetId: c.activeSheet.id, address,
      comment: text.trim() ? { text, ...(comment?.author ? { author: comment.author } : {}) } : null }, accepted);
  };
  const close = () => { cancelled.current = true; c.cancelEditRequest(); markPending(false); c.setCommentOpen(false); c.requestGridFocus(); };
  if (c.disabled && !c.requesting) return <div className="lxs-comment-content">{comment?.author && <p className="lxs-comment-author">{comment.author}</p>}<p>{comment?.text || "このセルにはコメントがありません"}</p></div>;
  return <>
    {comment?.author && <p className="lxs-comment-author">{comment.author}</p>}
    <label className="lxs-comment-label" htmlFor={inputId}>コメント</label>
    <textarea id={inputId} className="lxs-comment-editor" aria-label={`${address} のコメントを編集`} placeholder="コメントを入力" maxLength={SPREADSHEET_LIMITS.commentLength} value={text} readOnly={c.disabled || c.requesting}
      onChange={event => { setText(event.target.value); markPending(event.target.value !== (comment?.text ?? "")); }} onBlur={() => commit()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && c.features.save) { event.preventDefault(); commit(() => void c.save()); }
      }} />
    <div className="lxs-comment-actions"><button type="button" className="lxs-comment-apply" disabled={c.disabled || c.requesting} onClick={() => commit()}>適用</button>
      {comment && <button type="button" className="lxs-object-delete" disabled={c.disabled || c.requesting} onClick={() => c.afterCommand({ type: "comments.set", sheetId: c.activeSheet.id, address, comment: null }, () => { markPending(false); setText(""); })}>削除</button>}
    </div>
    <p className="lxs-object-hint">セルを選択すると、そのセルのコメントを表示します。変更はブックの保存時に保存されます。</p>
  </>;
}
