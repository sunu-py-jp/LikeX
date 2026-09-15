"use client";

import { useState } from "react";
import { SPREADSHEET_SHAPES, type SpreadsheetShapeCategory, type SpreadsheetShapeKind } from "../model/shapes";
import { Shape } from "./drawings/shape";
import { Command, Icon } from "./spreadsheet-controls";
import { SpreadsheetDialog } from "./spreadsheet-dialog";

const categories: readonly { id: SpreadsheetShapeCategory; label: string }[] = [
  { id: "basic", label: "基本図形" }, { id: "arrows", label: "ブロック矢印" }, { id: "lines", label: "線" },
];

export function SpreadsheetShapeGallery({ disabled, onSelect }: { disabled: boolean; onSelect: (kind: SpreadsheetShapeKind) => void }) {
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
            {SPREADSHEET_SHAPES.filter(shape => shape.category === category.id).map(shape => <button type="button" key={shape.kind}
              className="lxs-shape-gallery-item" aria-label={shape.label} title={shape.label} onClick={() => {
                if (disabled) return;
                setOpen(false); onSelect(shape.kind);
              }}>
              <span className="lxs-shape-gallery-preview"><Shape drawing={{ id: `preview-${shape.kind}`, type: "shape", shape: shape.kind,
                anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, width: 44, height: 32,
                fill: "var(--lxs-selection)", stroke: "currentColor", strokeWidth: 1.5 }} /></span>
              <span>{shape.label}</span>
            </button>)}
          </div>
        </section>)}
      </div>
    </SpreadsheetDialog>}
  </>;
}
