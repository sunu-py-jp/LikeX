"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetShapeDrawing } from "../model";
import type { SpreadsheetCommand } from "../api/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { readImageResource } from "../state/read-image";
import { Command, Icon } from "./spreadsheet-controls";

type ImageRequest = { abort: AbortController; workbook: SpreadsheetController["workbook"]; selection: SpreadsheetController["selection"]; sheetId: string };
function acceptsImage(c: SpreadsheetController, request: ImageRequest) {
  // Completion selects the image, so it must not close a newer unsaved editor.
  const workbook = c.getWorkbook();
  return !c.disabled && !c.editing && !c.pendingObjectEdit && c.features.images && workbook === request.workbook && c.selection === request.selection &&
    c.activeSheet.id === request.sheetId && workbook.sheets.some(sheet => sheet.id === request.sheetId);
}

export function SpreadsheetInsertToolbar({ controller: c }: { controller: SpreadsheetController }) {
  const latest = useRef(c), mounted = useRef(false), pending = useRef<ImageRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  useLayoutEffect(() => {
    latest.current = c;
    if (pending.current && !acceptsImage(c, pending.current)) pending.current.abort.abort();
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort.abort(); };
  }, []);
  const anchor = () => ({ ...latest.current.selection.focus, offsetX: 0, offsetY: 0 });
  const insert = (command: Extract<SpreadsheetCommand, { type: "shapes.insert" | "textBoxes.insert" }>, feature: "shapes" | "textBoxes") => {
    const current = latest.current;
    if (current.disabled || !current.features[feature] || !current.commitEdit()) return;
    const result = current.executeCommand(command);
    if (result.ok && result.results[0]?.drawingId) current.selectDrawing(result.results[0].drawingId);
  };
  const shape = (kind: SpreadsheetShapeDrawing["shape"]) => insert({ type: "shapes.insert", sheetId: latest.current.activeSheet.id, shape: kind,
    anchor: anchor() }, "shapes");
  const upload = async (file: File) => {
    const current = latest.current;
    if (current.disabled || !current.features.images || !current.commitEdit()) return;
    pending.current?.abort.abort();
    const request: ImageRequest = { abort: new AbortController(), workbook: current.getWorkbook(), selection: current.selection, sheetId: current.activeSheet.id };
    pending.current = request;
    setLoading(true);
    try {
      const resource = await readImageResource(file, { signal: request.abort.signal });
      const live = latest.current;
      // acceptsImage reads the synchronous draft, including edits before the next React render.
      if (!mounted.current || request.abort.signal.aborted || !acceptsImage(live, request)) return;
      const result = live.executeCommand({ type: "images.insert", sheetId: request.sheetId, resource,
        anchor: { ...request.selection.focus, offsetX: 0, offsetY: 0 } });
      if (result.ok && result.results[0]?.drawingId) live.selectDrawing(result.results[0].drawingId);
    } catch (cause) {
      if (mounted.current && !request.abort.signal.aborted && acceptsImage(latest.current, request)) latest.current.reportError(cause);
    } finally {
      if (pending.current === request) { pending.current = null; if (mounted.current) setLoading(false); }
    }
  };
  return <div className="lxs-ribbon" role="toolbar" aria-label="シートへの挿入">
    {!c.readOnly && c.features.images && <div className="lxs-tool-group">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="挿入する画像ファイル" disabled={c.disabled || loading} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void upload(file);
      }} />
      <Command label="画像を挿入" className="lxs-insert-command" disabled={c.disabled || loading} onClick={() => {
        if (!latest.current.disabled && latest.current.features.images && latest.current.commitEdit()) input.current?.click();
      }}><Icon name="image" /><span>画像</span></Command>
    </div>}
    {!c.readOnly && c.features.shapes && <div className="lxs-tool-group">
      <select className="lxs-select lxs-insert-select" aria-label="図形を挿入" value="" disabled={c.disabled} onChange={event => {
        const value = event.target.value;
        if (value === "rectangle" || value === "ellipse" || value === "line" || value === "arrow") shape(value);
      }}><option value="" disabled>図形</option><option value="rectangle">長方形</option><option value="ellipse">楕円</option><option value="line">直線</option><option value="arrow">矢印</option></select>
    </div>}
    {!c.readOnly && c.features.textBoxes && <div className="lxs-tool-group">
      <Command label="テキストボックスを挿入" className="lxs-insert-command" disabled={c.disabled} onClick={() => insert({ type: "textBoxes.insert", sheetId: latest.current.activeSheet.id, anchor: anchor() }, "textBoxes")}><Icon name="text" /><span>テキストボックス</span></Command>
    </div>}
    {!c.readOnly && c.features.comments && <div className="lxs-tool-group">
      <Command label="コメントを挿入" className="lxs-insert-command" disabled={c.disabled} onClick={() => {
        const live = latest.current;
        if (!live.disabled && live.features.comments && live.commitEdit()) { live.selectDrawing(null); live.setCommentOpen(true); }
      }}><Icon name="comment" /><span>コメント</span></Command>
    </div>}
    {loading && <span className="lxs-ribbon-hint" role="status">画像を読み込み中…</span>}
  </div>;
}
