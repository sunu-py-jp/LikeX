import { useState } from "react";
import { OFFICE_SHAPE_PRESETS, getOfficeShapeGeometry } from "../model/core-office-shapes";
import { getShapes } from "../model/index";
import type { DocumentEditor } from "../state/use-document-editor";
import { DocumentDialog } from "./document-dialog";

export function DocumentShapeTools({ editor, insert = false }: { editor: DocumentEditor; insert?: boolean }) {
  const [editing, setEditing] = useState<{ id: string; document: DocumentEditor["document"] } | null>(null);
  const shapes = getShapes(editor.document), selected = shapes.find(item => item.from === editor.selection.from && item.to === editor.selection.to);
  const shape = shapes.find(item => item.id === editing?.id), attrs = shape?.node.attrs;
  if (!editor.features.shapes) return null;
  return <>
    {insert && <details className="lxd-shape-gallery"><summary aria-label="図形を挿入">図形を挿入</summary><div className="lxd-shape-options" role="group" aria-label="図形の種類">{OFFICE_SHAPE_PRESETS.map(item => <button type="button" key={item.preset} title={item.label} aria-label={item.label} disabled={!editor.editable} onClick={event => {
      event.currentTarget.closest("details")?.removeAttribute("open");
      void editor.execute({ type: "shape.insert", at: editor.selection.to, preset: item.preset });
    }}><svg width="36" height="28" viewBox="-2 -2 44 32" aria-hidden="true">{getOfficeShapeGeometry(item.preset, 40, 28).paths.map((path, index) => <path key={index} d={path.d} fill={path.fill === false ? "none" : "currentColor"} fillOpacity={.15} stroke={path.stroke === false ? "none" : "currentColor"} strokeWidth={1.2} />)}</svg><span>{item.label}</span></button>)}</div></details>}
    {selected && <button type="button" className="lxd-ribbon-action" disabled={!editor.editable || (!editor.features.text && !editor.features.formatting)} onClick={() => setEditing({ id: selected.id, document: editor.document })}>図形の書式</button>}
    {attrs && shape && <DocumentDialog title="図形の書式" submitLabel="適用" onClose={() => setEditing(null)} onSubmit={data => {
      void editor.execute({ type: "shape.update", id: shape.id, ...(editor.features.text ? { text: String(data.get("text") ?? "") } : {}), ...(editor.features.formatting ? { width: Number(data.get("width")), height: Number(data.get("height")), rotation: Number(data.get("rotation")), strokeWidth: Number(data.get("strokeWidth")), fill: data.get("noFill") ? null : String(data.get("fill")), stroke: data.get("noStroke") ? null : String(data.get("stroke")), color: String(data.get("color")), fontSize: Number(data.get("fontSize")), flipH: data.get("flipH") === "on", flipV: data.get("flipV") === "on" } : {}) }, { isCurrent: () => editor.session.getSnapshot().document === editing?.document });
      setEditing(null);
    }}>
      <label>テキスト<textarea disabled={!editor.editable || !editor.features.text} name="text" defaultValue={attrs.text} rows={3} maxLength={100000} /></label>
      <div className="lxd-shape-fields"><label>幅 (px)<input disabled={!editor.editable || !editor.features.formatting} name="width" type="number" min={1} max={16384} step="any" required defaultValue={attrs.width} /></label><label>高さ (px)<input disabled={!editor.editable || !editor.features.formatting} name="height" type="number" min={1} max={16384} step="any" required defaultValue={attrs.height} /></label><label>回転 (°)<input disabled={!editor.editable || !editor.features.formatting} name="rotation" type="number" min={-360} max={360} step="any" required defaultValue={attrs.rotation} /></label><label>線の太さ (px)<input disabled={!editor.editable || !editor.features.formatting} name="strokeWidth" type="number" min={0} max={100} step="any" required defaultValue={attrs.strokeWidth} /></label>
      <label>塗りつぶし<input disabled={!editor.editable || !editor.features.formatting} name="fill" type="color" defaultValue={attrs.fill ?? "#dbeafe"} /></label><label>線の色<input disabled={!editor.editable || !editor.features.formatting} name="stroke" type="color" defaultValue={attrs.stroke ?? "#2563eb"} /></label><label>文字色<input disabled={!editor.editable || !editor.features.formatting} name="color" type="color" defaultValue={attrs.color} /></label><label>文字サイズ (pt)<input disabled={!editor.editable || !editor.features.formatting} name="fontSize" type="number" min={4} max={240} step="any" required defaultValue={attrs.fontSize} /></label></div>
      <label className="lxd-checkbox"><input disabled={!editor.editable || !editor.features.formatting} name="noFill" type="checkbox" defaultChecked={attrs.fill === null} />塗りつぶしなし</label><label className="lxd-checkbox"><input disabled={!editor.editable || !editor.features.formatting} name="noStroke" type="checkbox" defaultChecked={attrs.stroke === null} />線なし</label><label className="lxd-checkbox"><input disabled={!editor.editable || !editor.features.formatting} name="flipH" type="checkbox" defaultChecked={attrs.flipH} />左右反転</label><label className="lxd-checkbox"><input disabled={!editor.editable || !editor.features.formatting} name="flipV" type="checkbox" defaultChecked={attrs.flipV} />上下反転</label>
    </DocumentDialog>}
  </>;
}
