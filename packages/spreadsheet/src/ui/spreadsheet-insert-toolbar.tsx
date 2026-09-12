"use client";

import { HorizontalScrollStrip } from "./horizontal-scroll-strip";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetShapeDrawing } from "../model";
import type { SpreadsheetCommand } from "../api/types";
import type { SpreadsheetController } from "../state/use-spreadsheet";
import { readImageResource } from "../state/read-image";
import { Command, Icon } from "./spreadsheet-controls";
import { SpreadsheetTableTools } from "./spreadsheet-table-tools";
import { RibbonGroup } from "./spreadsheet-ribbon-group";

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
    if (current.disabled || !current.features[feature]) return;
    current.afterCommit(() => latest.current.afterCommand(command, result => {
      if (result.results[0]?.drawingId) latest.current.selectDrawing(result.results[0].drawingId);
    }));
  };
  const shape = (kind: SpreadsheetShapeDrawing["shape"]) => insert({ type: "shapes.insert", sheetId: latest.current.activeSheet.id, shape: kind,
    anchor: anchor() }, "shapes");
  const upload = (file: File) => {
    const current = latest.current;
    if (current.disabled || !current.features.images) return;
    current.afterCommit(() => { if (mounted.current) void prepareImage(file); });
  };
  const prepareImage = async (file: File) => {
    const current = latest.current;
    // afterCommit may complete before React renders the cleared permission state.
    if (!current.features.images || current.readOnly) return;
    pending.current?.abort.abort();
    const request: ImageRequest = { abort: new AbortController(), workbook: current.getWorkbook(), selection: current.selection, sheetId: current.activeSheet.id };
    pending.current = request;
    setLoading(true);
    try {
      const resource = await readImageResource(file, { signal: request.abort.signal });
      const live = latest.current;
      // acceptsImage reads the synchronous draft, including edits before the next React render.
      if (!mounted.current || request.abort.signal.aborted || !acceptsImage(live, request)) return;
      live.afterCommand({ type: "images.insert", sheetId: request.sheetId, resource,
        anchor: { ...request.selection.focus, offsetX: 0, offsetY: 0 } }, result => {
        if (mounted.current && result.results[0]?.drawingId) latest.current.selectDrawing(result.results[0].drawingId);
      });
    } catch (cause) {
      if (mounted.current && !request.abort.signal.aborted && acceptsImage(latest.current, request)) latest.current.reportError(cause);
    } finally {
      if (pending.current === request) { pending.current = null; if (mounted.current) setLoading(false); }
    }
  };
  return <HorizontalScrollStrip className="lxs-ribbon" role="toolbar" aria-label="シートへの挿入" itemSelector=".lxs-ribbon-group" previousLabel="前のリボングループを表示" nextLabel="次のリボングループを表示">
    <SpreadsheetTableTools controller={c} />
    {!c.readOnly && (c.features.images || c.features.shapes || c.features.textBoxes) && <RibbonGroup label="図"><div className="lxs-ribbon-columns">
    {c.features.images && <>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label="挿入する画像ファイル" disabled={c.disabled || c.requesting || loading} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void upload(file);
      }} />
      <Command label="画像を挿入" className="lxs-ribbon-command-large" disabled={c.disabled || c.requesting || loading} onClick={() => {
        if (!latest.current.disabled && latest.current.features.images) latest.current.afterCommit(() => input.current?.click());
      }}><Icon name="image" /><span>画像</span></Command>
    </>}
    {(c.features.shapes || c.features.textBoxes) && <div className="lxs-ribbon-stack">
    {c.features.shapes && <div className="lxs-ribbon-row">
      <Icon name="shape" />
      <select className="lxs-select lxs-insert-select" aria-label="図形を挿入" value="" disabled={c.disabled || c.requesting} onChange={event => {
        const value = event.target.value;
        if (value === "rectangle" || value === "ellipse" || value === "line" || value === "arrow") shape(value);
      }}><option value="" disabled>図形</option><option value="rectangle">長方形</option><option value="ellipse">楕円</option><option value="line">直線</option><option value="arrow">矢印</option></select>
    </div>}
    {c.features.textBoxes && <Command label="テキストボックスを挿入" className="lxs-ribbon-command-label" disabled={c.disabled || c.requesting} onClick={() => insert({ type: "textBoxes.insert", sheetId: latest.current.activeSheet.id, anchor: anchor() }, "textBoxes")}><Icon name="text" /><span>テキストボックス</span></Command>}
    </div>}
    </div></RibbonGroup>}
    {!c.readOnly && c.features.comments && <RibbonGroup label="コメント">
      <Command label="コメントを挿入" className="lxs-ribbon-command-large" disabled={c.disabled || c.requesting} onClick={() => {
        const live = latest.current;
        if (!live.disabled && live.features.comments) live.afterCommit(() => { latest.current.selectDrawing(null); latest.current.setCommentOpen(true); });
      }}><Icon name="comment" /><span>コメント</span></Command>
    </RibbonGroup>}
    {loading && <span className="lxs-ribbon-hint" role="status">画像を読み込み中…</span>}
  </HorizontalScrollStrip>;
}
