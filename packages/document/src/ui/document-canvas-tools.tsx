import { useEffect, useMemo, useRef, useState } from "react";
import { getCanvases, getDocumentCanvasConnectorRoute } from "../model/index";
import { OFFICE_SHAPE_PRESETS, getOfficeShapeGeometry, type OfficeShapePreset } from "../model/core-office-shapes";
import { CONNECTOR_PORTS, CONNECTOR_ARROWHEADS, type ConnectorPort } from "../model/core-connectors";
import { canvasArrowPath, canvasLinePath, canvasShapeTransform } from "../model/canvas-dom";
import type { DocumentCanvasShape, DocumentCanvasConnector, DocumentCanvasAttributes, DocumentModel } from "../model/types";
import type { DocumentEditor } from "../state/use-document-editor";
import { DocumentDialog } from "./document-dialog";
function canvasPoint(svg: SVGSVGElement, x: number, y: number) {
  const point = svg.createSVGPoint(); point.x = x; point.y = y;
  return point.matrixTransform(svg.getScreenCTM()!.inverse());
}
const ports: Record<ConnectorPort, string> = { top: "上", topRight: "右上", right: "右", bottomRight: "右下", bottom: "下", bottomLeft: "左下", left: "左", topLeft: "左上" };
const heads = { none: "なし", triangle: "三角", openArrow: "開いた矢印", diamond: "ひし形", oval: "丸", stealth: "ステルス" };
export function DocumentCanvasTools({ editor, insert = false }: { editor: DocumentEditor; insert?: boolean }) {
  const canvases = useMemo(() => getCanvases(editor.document), [editor.document]);
  const selected = canvases.find(item => item.from === editor.selection.from && item.to === editor.selection.to);
  const [open, setOpen] = useState<string | null>(null), current = canvases.find(item => item.id === open);
  if (!editor.features.shapes) return null;
  return <>
    {insert && <button type="button" className="lxd-ribbon-action" aria-label="描画キャンバスを挿入" disabled={!editor.editable} onClick={() => void editor.execute({ type: "canvas.insert", at: editor.selection.to })}>描画キャンバス</button>}
    {selected && <button type="button" className="lxd-ribbon-action" aria-label="描画キャンバスを編集" onClick={() => setOpen(selected.id)}>キャンバスを編集</button>}
    {current && <CanvasEditor key={current.id} editor={editor} canvasId={current.id} canvas={current.node.attrs} onClose={() => setOpen(null)} />}
  </>;
}
function CanvasEditor({ editor, canvasId, canvas, onClose }: { editor: DocumentEditor; canvasId: string; canvas: DocumentCanvasAttributes; onClose(): void }) {
  const [selection, setSelection] = useState<string | null>(null), [preset, setPreset] = useState<OfficeShapePreset>("roundRect");
  const [from, setFrom] = useState(""), [to, setTo] = useState(""), [fromPort, setFromPort] = useState<ConnectorPort>("right"), [toPort, setToPort] = useState<ConnectorPort>("left");
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; pointer: number; start: { x: number; y: number }; x: number; y: number; document: DocumentModel } | null>(null);
  useEffect(() => { if (drag.current && drag.current.document !== editor.document) { drag.current = null; setPreview(null); } }, [editor.document]);
  const writable = editor.editable && editor.features.shapes, formatting = writable && editor.features.formatting;
  const shapes = canvas.shapes ?? [], lines = canvas.connectors ?? [], shape = shapes.find(item => item.id === selection), line = lines.find(item => item.id === selection);
  const displayed = preview ? { ...canvas, shapes: shapes.map(item => item.id === preview.id ? { ...item, x: preview.x, y: preview.y } : item) } : canvas;
  const startId = shapes.some(item => item.id === from) ? from : shapes[0]?.id ?? "", endId = shapes.some(item => item.id === to) ? to : shapes[1]?.id ?? shapes[0]?.id ?? "";
  const label = (shape: DocumentCanvasShape) => shape.text?.slice(0, 24) || OFFICE_SHAPE_PRESETS.find(item => item.preset === shape.preset)?.label || shape.id;
  const updateShape = (patch: Partial<Omit<DocumentCanvasShape, "id">>) => shape && editor.execute({ type: "canvas.shape.update", canvasId, id: shape.id, patch }, { historyGroup: "text" in patch ? `canvas-text-${shape.id}` : undefined });
  const updateLine = (patch: Partial<Omit<DocumentCanvasConnector, "id">>) => line && editor.execute({ type: "canvas.connector.update", canvasId, id: line.id, patch });
  const endpoint = (targetId: string, port: ConnectorPort) => ({ x: 0, y: 0, binding: { targetId, port } });
  return <DocumentDialog title="描画キャンバス" submitLabel="閉じる" hideCancel onClose={onClose} onSubmit={onClose}>
    <div className="lxd-canvas-workspace">
      <div className="lxd-canvas-toolbar"><select aria-label="キャンバスに追加する図形" value={preset} disabled={!writable} onChange={event => setPreset(event.target.value as OfficeShapePreset)}>{OFFICE_SHAPE_PRESETS.map(item => <option key={item.preset} value={item.preset}>{item.label}</option>)}</select>
        <button type="button" disabled={!writable} onClick={async () => { const id = crypto.randomUUID(); const result = await editor.execute({ type: "canvas.shape.insert", canvasId, shape: { id, preset, ...(editor.features.formatting ? { width: 150, height: 80 } : {}), x: 30 + shapes.length % 3 * 180, y: 30 + Math.floor(shapes.length / 3) * 110 } }); if (result) setSelection(id); }}>図形を追加</button>
        <button type="button" disabled={!writable || (!shape && !line)} onClick={() => { if (shape || line) void editor.execute({ type: shape ? "canvas.shape.delete" : "canvas.connector.delete", canvasId, id: selection! }); setSelection(null); }}>選択を削除</button>
      </div>
      <div className="lxd-canvas-connect"><span>接続線</span><select aria-label="接続元の図形" disabled={!writable} value={startId} onChange={event => setFrom(event.target.value)}>{shapes.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select><select aria-label="接続元の位置" disabled={!writable} value={fromPort} onChange={event => setFromPort(event.target.value as ConnectorPort)}>{CONNECTOR_PORTS.map(port => <option key={port} value={port}>{ports[port]}</option>)}</select><span>→</span><select aria-label="接続先の図形" disabled={!writable} value={endId} onChange={event => setTo(event.target.value)}>{shapes.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select><select aria-label="接続先の位置" disabled={!writable} value={toPort} onChange={event => setToPort(event.target.value as ConnectorPort)}>{CONNECTOR_PORTS.map(port => <option key={port} value={port}>{ports[port]}</option>)}</select><button type="button" disabled={!writable || !startId || !endId} onClick={async () => { const id = crypto.randomUUID(); const result = await editor.execute({ type: "canvas.connector.insert", canvasId, connector: { id, start: endpoint(startId, fromPort), end: endpoint(endId, toPort) } }); if (result) setSelection(id); }}>直交コネクタを追加</button></div>
      <svg className="lxd-canvas-editor" role="img" aria-label="キャンバス内の図形と接続線" viewBox={`0 0 ${canvas.width} ${canvas.height}`} onPointerMove={event => { const current = drag.current; if (!current || current.pointer !== event.pointerId) return; const point = canvasPoint(event.currentTarget, event.clientX, event.clientY); setPreview({ id: current.id, x: current.x + point.x - current.start.x, y: current.y + point.y - current.start.y }); }} onPointerUp={event => {
        const current = drag.current; drag.current = null; if (!current || current.pointer !== event.pointerId) return;
        const point = canvasPoint(event.currentTarget, event.clientX, event.clientY), x = current.x + point.x - current.start.x, y = current.y + point.y - current.start.y;
        setPreview(null); if (x !== current.x || y !== current.y) void editor.execute({ type: "canvas.shape.update", canvasId, id: current.id, patch: { x, y } }, { isCurrent: () => editor.session.getSnapshot().document === current.document });
      }} onPointerCancel={() => { drag.current = null; setPreview(null); }} onKeyDown={event => {
        if (event.key === "Escape") { drag.current = null; setPreview(null); }
        if ((event.key === "Delete" || event.key === "Backspace") && writable && (shape || line)) { event.preventDefault(); event.stopPropagation(); void editor.execute({ type: shape ? "canvas.shape.delete" : "canvas.connector.delete", canvasId, id: selection! }); setSelection(null); }
      }}>
        {lines.map(item => { const route = getDocumentCanvasConnectorRoute(displayed, item); return <g key={item.id} role="button" aria-label={`接続線 ${item.id}`} tabIndex={0} onClick={() => setSelection(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelection(item.id); }}>
          <defs>{(["start", "end"] as const).map(end => { const kind = end === "start" ? item.startArrow : item.endArrow; return !kind || kind === "none" ? null : <marker key={end} id={`canvas-editor-${encodeURIComponent(item.id)}-${end}`} viewBox="0 0 8 8" refX={8} refY={4} markerWidth={8} markerHeight={8} markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d={canvasArrowPath(kind)} fill={kind === "openArrow" ? "none" : item.stroke} stroke={item.stroke} /></marker>; })}</defs>
          <path d={canvasLinePath(route.points)} fill="none" stroke="transparent" strokeWidth={14} /><path d={canvasLinePath(route.points)} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} markerStart={item.startArrow === "none" ? undefined : `url(#canvas-editor-${encodeURIComponent(item.id)}-start)`} markerEnd={item.endArrow === "none" ? undefined : `url(#canvas-editor-${encodeURIComponent(item.id)}-end)`} />
          {selection === item.id && route.points.filter((_point, i) => i === 0 || i === route.points.length - 1).map((point, i) => <circle key={i} cx={point.x} cy={point.y} r={5} fill="#fff" stroke="#2563eb" />)}</g>; })}
        {(displayed.shapes ?? []).map(item => { const geometry = getOfficeShapeGeometry(item.preset, item.width!, item.height!), rect = geometry.textRect; return <g key={item.id} role="button" aria-label={`図形 ${label(item)}`} tabIndex={0} transform={canvasShapeTransform(item)} onClick={() => setSelection(item.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setSelection(item.id); }} onPointerDown={event => {
          setSelection(item.id); event.currentTarget.focus(); if (!formatting || event.button !== 0) return; const svg = event.currentTarget.ownerSVGElement!; svg.setPointerCapture(event.pointerId);
          drag.current = { id: item.id, pointer: event.pointerId, start: canvasPoint(svg, event.clientX, event.clientY), x: item.x, y: item.y, document: editor.session.getSnapshot().document }; event.preventDefault();
        }}>
          {geometry.paths.map((path, i) => <path key={i} d={path.d} fill={path.fill === false ? "none" : item.fill ?? "none"} stroke={path.stroke === false ? "none" : item.stroke ?? "none"} strokeWidth={item.strokeWidth} />)}
          <text x={rect.left + rect.width / 2} y={rect.top + rect.height / 2} textAnchor="middle" dominantBaseline="middle" fill={item.color} fontSize={(item.fontSize ?? 14) * 4 / 3}>{(item.text ?? "").split("\n").map((text, i, lines) => <tspan key={i} x={rect.left + rect.width / 2} dy={i ? "1.2em" : `${-(lines.length - 1) * .6}em`}>{text}</tspan>)}</text>
          {selection === item.id && <rect x={-3} y={-3} width={item.width! + 6} height={item.height! + 6} fill="none" stroke="#2563eb" strokeDasharray="5 3" />}
        </g>; })}
      </svg>
      {shape && <div className="lxd-canvas-properties"><strong>図形の書式</strong><label>テキスト<textarea aria-label="キャンバス図形のテキスト" value={shape.text} disabled={!writable || !editor.features.text} onChange={event => void updateShape({ text: event.target.value })} /></label>
        {(["x", "y", "width", "height", "rotation", "strokeWidth", "fontSize"] as const).map(key => <label key={key}>{{ x: "X", y: "Y", width: "幅", height: "高さ", rotation: "回転", strokeWidth: "線幅", fontSize: "文字サイズ" }[key]}<input aria-label={`キャンバス図形 ${key}`} type="number" value={shape[key]} disabled={!formatting} onChange={event => void updateShape({ [key]: Number(event.target.value) })} /></label>)}
        {(["fill", "stroke", "color"] as const).map(key => <label key={key}>{{ fill: "塗り", stroke: "線色", color: "文字色" }[key]}<input aria-label={`キャンバス図形 ${key}`} type="color" value={shape[key] ?? "#ffffff"} disabled={!formatting} onChange={event => void updateShape({ [key]: event.target.value })} /></label>)}
        <label><input type="checkbox" checked={shape.flipH} disabled={!formatting} onChange={event => void updateShape({ flipH: event.target.checked })} />左右反転</label><label><input type="checkbox" checked={shape.flipV} disabled={!formatting} onChange={event => void updateShape({ flipV: event.target.checked })} />上下反転</label>
      </div>}
      {line && <div className="lxd-canvas-properties"><strong>接続線の書式</strong><label>経路<select aria-label="接続線の経路" value={line.routing} disabled={!formatting} onChange={event => void updateLine({ routing: event.target.value as "straight" | "elbow" })}><option value="elbow">自動直交</option><option value="straight">直線</option></select></label><label>線色<input type="color" aria-label="接続線の色" value={line.stroke} disabled={!formatting} onChange={event => void updateLine({ stroke: event.target.value })} /></label><label>線幅<input type="number" aria-label="接続線の太さ" value={line.strokeWidth} disabled={!formatting} onChange={event => void updateLine({ strokeWidth: Number(event.target.value) })} /></label>
        {(["start", "end"] as const).map(end => <div key={end}><label>{end === "start" ? "始点" : "終点"}<select aria-label={`接続線 ${end} 図形`} value={line[end].binding?.targetId ?? ""} disabled={!formatting} onChange={event => void updateLine({ [end]: event.target.value ? endpoint(event.target.value, line[end].binding?.port ?? (end === "start" ? "right" : "left")) : { x: line[end].x, y: line[end].y } })}><option value="">接続なし</option>{shapes.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label><select aria-label={`接続線 ${end} 位置`} value={line[end].binding?.port ?? "right"} disabled={!formatting || !line[end].binding} onChange={event => void updateLine({ [end]: endpoint(line[end].binding!.targetId, event.target.value as ConnectorPort) })}>{CONNECTOR_PORTS.map(port => <option key={port} value={port}>{ports[port]}</option>)}</select><select aria-label={`接続線 ${end} 矢印`} value={end === "start" ? line.startArrow : line.endArrow} disabled={!formatting} onChange={event => void updateLine({ [end === "start" ? "startArrow" : "endArrow"]: event.target.value })}>{CONNECTOR_ARROWHEADS.map(head => <option key={head} value={head}>{heads[head]}</option>)}</select></div>)}
      </div>}
    </div>
  </DocumentDialog>;
}
