"use client";

import type { SpreadsheetLineRouting } from "../model/types";
import type { ConnectorArrowhead } from "../core";
import { useId, useState } from "react";
import { SPREADSHEET_SHAPES, type SpreadsheetShapeCategory, type SpreadsheetShapeKind } from "../model/shapes";
import { Shape } from "./drawings/shape";
import { LineMarker } from "./drawings/line-marker";
import { Command, Icon } from "./spreadsheet-controls";
import { SpreadsheetDialog } from "./spreadsheet-dialog";

const categories: readonly { id: SpreadsheetShapeCategory; label: string }[] = [
  { id: "basic", label: "基本図形" }, { id: "arrows", label: "ブロック矢印" }, { id: "flowchart", label: "フローチャート" }, { id: "lines", label: "線" },
];

function LinePreview({ startArrow, endArrow, routing }: { startArrow: ConnectorArrowhead; endArrow: ConnectorArrowhead; routing?: SpreadsheetLineRouting }) {
  const marker = useId().replace(/:/g, "");
  return <svg width="44" height="32" viewBox="0 0 44 32" aria-hidden="true">
    <defs><LineMarker id={`${marker}-start`} kind={startArrow} color="currentColor" />
      <LineMarker id={`${marker}-end`} kind={endArrow} color="currentColor" /></defs>
    <polyline points={routing === "elbow" ? "4,6 22,6 22,26 40,26" : "4,16 40,16"} fill="none" stroke="currentColor" strokeWidth="1.5"
      markerStart={startArrow !== "none" ? `url(#${marker}-start)` : undefined}
      markerEnd={endArrow !== "none" ? `url(#${marker}-end)` : undefined} />
  </svg>;
}

export function SpreadsheetShapeGallery({ disabled, onSelect }: { disabled: boolean; onSelect: (kind: SpreadsheetShapeKind, markers?: { startArrow: ConnectorArrowhead; endArrow: ConnectorArrowhead; routing?: SpreadsheetLineRouting }) => void }) {
  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);
  return <>
    <Command label="図形を挿入" className="lxs-ribbon-command-label" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { if (!disabled) setOpen(true); }}><Icon name="shape" /><span>図形</span><span aria-hidden="true">▾</span></Command>
    {open && !disabled && <SpreadsheetDialog title="図形を挿入" className="lxs-shape-gallery-dialog" onClose={() => setOpen(false)}>
      <div className="lxs-shape-gallery">
        {categories.map(category => <section key={category.id} aria-label={category.label}>
          <h3>{category.label}</h3>
          <div className="lxs-shape-gallery-grid">
            {SPREADSHEET_SHAPES.filter(shape => shape.category === category.id && category.id !== "lines").map(shape => <button type="button" key={shape.kind}
              className="lxs-shape-gallery-item" aria-label={shape.label} title={shape.label} onClick={() => {
                if (disabled) return;
                setOpen(false); onSelect(shape.kind);
              }}>
              <span className="lxs-shape-gallery-preview"><Shape drawing={{ id: `preview-${shape.kind}`, type: "shape", shape: shape.kind,
                anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 44, height: 32,
                fill: "var(--lxs-selection)", stroke: "currentColor", strokeWidth: 1.5 }} /></span>
              <span>{shape.label}</span>
            </button>)}
            {category.id === "lines" && ([
              { id: "plain", label: "直線", startArrow: "none", endArrow: "none", routing: "straight" },
              { id: "right", label: "右向き矢印線", startArrow: "none", endArrow: "triangle", routing: "straight" },
              { id: "left", label: "左向き矢印線", startArrow: "triangle", endArrow: "none", routing: "straight" },
              { id: "both", label: "双方向矢印線", startArrow: "triangle", endArrow: "triangle", routing: "straight" },
              { id: "elbow", label: "折れ線", startArrow: "none", endArrow: "none", routing: "elbow" },
              { id: "elbow-arrow", label: "矢印付き折れ線", startArrow: "none", endArrow: "triangle", routing: "elbow" },
            ] as const).map(preset => <button type="button" key={preset.id} className="lxs-shape-gallery-item" aria-label={preset.label} title={preset.label}
              onClick={() => { if (!disabled) { setOpen(false); onSelect("line", { startArrow: preset.startArrow, endArrow: preset.endArrow, routing: preset.routing }); } }}>
              <span className="lxs-shape-gallery-preview"><LinePreview startArrow={preset.startArrow} endArrow={preset.endArrow} routing={preset.routing} /></span><span>{preset.label}</span>
            </button>)}
          </div>
        </section>)}
      </div>
    </SpreadsheetDialog>}
  </>;
}
