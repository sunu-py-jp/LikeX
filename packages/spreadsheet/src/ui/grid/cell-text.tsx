"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CellTextOverflow } from "./cell-text-layout";
import type { SpreadsheetCellFormat } from "../../model/types";
import { cellTextIndentStyle } from "./cell-style";
import { AlignedCellText } from "./aligned-cell-text";

type CellTextProps = { text: string; overflow: CellTextOverflow; align?: SpreadsheetCellFormat["align"];
  verticalAlign?: SpreadsheetCellFormat["verticalAlign"]; indent?: number; wrap?: boolean;
  resolvedAlign?: "left" | "center" | "right" | "justify"; shrink: boolean; revision: string; hidden: boolean };

/** The input keeps focus/IME; this noninteractive layer paints passive text. */
export function CellText({ text, overflow, align, resolvedAlign, verticalAlign, indent, wrap, shrink, revision, hidden }: CellTextProps) {
  const indented = cellTextIndentStyle({ align, indent });
  const placement = resolvedAlign ?? (align === "right" ? "right" : align === "center" || align === "centerContinuous" ? "center" : "left");
  if (text && (align === "fill" || align === "justify" || align === "distributed" || verticalAlign === "justify" || verticalAlign === "distributed" ||
    (align === "centerContinuous" && (wrap || shrink))))
    return <AlignedCellText text={text} align={!align || align === "general" ? placement : align} verticalAlign={verticalAlign}
      wrap={wrap} shrink={shrink} hidden={hidden} revision={revision} overflow={overflow.after > 0}
      style={{ ...indented, width: `calc(100% + ${overflow.after}px)` }} />;
  if (shrink && text) return <ShrunkCellText text={text} revision={revision} hidden={hidden} align={align} indent={indent} />;
  if (!overflow.before && !overflow.after)
    return <span className="lxs-cell-text" style={indented} aria-hidden={hidden || undefined}>{text}</span>;
  return <span className="lxs-cell-text lxs-cell-text-overflow" aria-hidden={hidden || undefined}
    style={{ marginLeft: -overflow.before, width: `calc(100% + ${overflow.before + overflow.after}px)` }}>
    <span className="lxs-cell-text-origin" style={{ ...indented, marginLeft: overflow.before,
      width: align === "centerContinuous" ? "100%" : `calc(100% - ${overflow.before + overflow.after}px)`,
      justifyContent: placement === "right" ? "flex-end" : placement === "center" ? "center" : "flex-start" }}>
      <span className="lxs-cell-text-content">{text}</span>
    </span>
  </span>;
}

function ShrunkCellText({ text, revision, hidden, align, indent }: Pick<CellTextProps, "text" | "revision" | "hidden" | "align" | "indent">) {
  const viewport = useRef<HTMLSpanElement>(null), measurement = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = viewport.current, probe = measurement.current;
    if (!box || !probe) return;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      // Both rectangles use screen pixels, including sheet and browser zoom.
      const width = box.getBoundingClientRect().width, natural = probe.getBoundingClientRect().width;
      const computed = box.ownerDocument.defaultView?.getComputedStyle?.(box);
      const logicalWidth = computed ? parseFloat(computed.width) : 0;
      const padding = computed ? (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0) : 0;
      const ratio = logicalWidth > 0 ? width / (logicalWidth + (computed?.boxSizing === "border-box" ? 0 : padding)) : 1;
      const available = Math.max(0, width - padding * ratio);
      if (width > 0 && natural > 0) setScale(Math.min(1, available / natural));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(box); observer?.observe(probe);
    const fonts = box.ownerDocument?.fonts;
    fonts?.addEventListener?.("loadingdone", update);
    void fonts?.ready.then(update, () => {});
    return () => { disposed = true; observer?.disconnect(); fonts?.removeEventListener?.("loadingdone", update); };
  }, [text, revision]);
  return <span ref={viewport} className="lxs-cell-text lxs-cell-text-shrink" style={cellTextIndentStyle({ align, indent })} aria-hidden={hidden || undefined}>
    <span ref={measurement} className="lxs-cell-text-measure" aria-hidden="true">{text}</span>
    <span className="lxs-cell-text-scaled" style={{ fontSize: `${scale * 100}%` }}>{text}</span>
  </span>;
}
