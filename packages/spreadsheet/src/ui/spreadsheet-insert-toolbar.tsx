"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { addDrawing, insertImage, type SpreadsheetDrawing, type SpreadsheetShapeDrawing } from "../model";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { readImageResource } from "../state/read-image";
import { Command, Icon } from "./spreadsheet-controls";

type ImageRequest = { abort: AbortController; workbook: SpreadsheetController["workbook"]; selection: SpreadsheetController["selection"]; sheetId: string };
function acceptsImage(c: SpreadsheetController, request: ImageRequest) {
  // Completion selects the image, so it must not close a newer unsaved editor.
  return !c.disabled && !c.editing && !c.pendingObjectEdit && c.features.images && c.workbook === request.workbook && c.selection === request.selection &&
    c.activeSheet.id === request.sheetId && c.workbook.sheets.some(sheet => sheet.id === request.sheetId);
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
  const insert = (drawing: SpreadsheetDrawing, feature: "shapes" | "textBoxes") => {
    const current = latest.current;
    if (current.disabled || !current.features[feature] || !current.commitEdit()) return;
    if (current.apply(workbook => addDrawing(workbook, current.activeSheet.id, drawing))) current.selectDrawing(drawing.id);
  };
  const shape = (kind: SpreadsheetShapeDrawing["shape"]) => insert({ id: crypto.randomUUID(), type: "shape", shape: kind,
    anchor: anchor(), width: 160, height: kind === "line" || kind === "arrow" ? 72 : 100,
    fill: kind === "line" || kind === "arrow" ? "transparent" : "#e8f3ec", stroke: "#217346", strokeWidth: 2 }, "shapes");
  const upload = async (file: File) => {
    const current = latest.current;
    if (current.disabled || !current.features.images || !current.commitEdit()) return;
    pending.current?.abort.abort();
    const request: ImageRequest = { abort: new AbortController(), workbook: current.workbook, selection: current.selection, sheetId: current.activeSheet.id };
    pending.current = request;
    setLoading(true);
    try {
      const resource = await readImageResource(file, { signal: request.abort.signal });
      const live = latest.current;
      if (!mounted.current || request.abort.signal.aborted || !acceptsImage(live, request)) return;
      const resourceId = crypto.randomUUID(), id = crypto.randomUUID();
      const scale = Math.min(1, 320 / resource.width, 240 / resource.height);
      const drawing = { id, type: "image" as const, resourceId, alt: resource.name,
        anchor: { ...request.selection.focus, offsetX: 0, offsetY: 0 }, width: Math.max(1, Math.round(resource.width * scale)), height: Math.max(1, Math.round(resource.height * scale)) };
      let inserted = false;
      live.apply(workbook => {
        // apply checks the live save/read-only guard; this identity check also
        // rejects a same-tick edit before the next React render reaches the ref.
        if (workbook !== request.workbook || !acceptsImage(latest.current, request)) return workbook;
        const result = insertImage(workbook, request.sheetId, resourceId, resource, drawing);
        inserted = true;
        return result;
      });
      if (inserted) live.selectDrawing(id);
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
      <Command label="テキストボックスを挿入" className="lxs-insert-command" disabled={c.disabled} onClick={() => insert({ id: crypto.randomUUID(), type: "text", anchor: anchor(),
        width: 200, height: 80, text: "テキスト", fontSize: 16, color: "currentColor", background: "transparent" }, "textBoxes")}><Icon name="text" /><span>テキストボックス</span></Command>
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
