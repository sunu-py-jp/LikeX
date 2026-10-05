"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CellTextOverflow } from "./cell-text-layout";

type CellTextProps = { text: string; overflow: CellTextOverflow; align?: "left" | "center" | "right"; shrink: boolean; revision: string; hidden: boolean };

/** The input keeps focus/IME; this noninteractive layer paints passive text. */
export function CellText({ text, overflow, align, shrink, revision, hidden }: CellTextProps) {
  if (shrink && text) return <ShrunkCellText text={text} revision={revision} hidden={hidden} />;
  if (!overflow.before && !overflow.after)
    return <span className="lxs-cell-text" aria-hidden={hidden || undefined}>{text}</span>;
  return <span className="lxs-cell-text lxs-cell-text-overflow" aria-hidden={hidden || undefined}
    style={{ marginLeft: -overflow.before, width: `calc(100% + ${overflow.before + overflow.after}px)` }}>
    <span className="lxs-cell-text-origin" style={{ marginLeft: overflow.before,
      width: `calc(100% - ${overflow.before + overflow.after}px)`,
      justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}>
      <span className="lxs-cell-text-content">{text}</span>
    </span>
  </span>;
}

function ShrunkCellText({ text, revision, hidden }: Pick<CellTextProps, "text" | "revision" | "hidden">) {
  const viewport = useRef<HTMLSpanElement>(null), measurement = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = viewport.current, probe = measurement.current;
    if (!box || !probe) return;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      // Both rectangles use screen pixels, including sheet and browser zoom.
      const available = box.getBoundingClientRect().width, natural = probe.getBoundingClientRect().width;
      if (available > 0 && natural > 0) setScale(Math.min(1, available / natural));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(box); observer?.observe(probe);
    const fonts = box.ownerDocument?.fonts;
    fonts?.addEventListener?.("loadingdone", update);
    void fonts?.ready.then(update, () => {});
    return () => { disposed = true; observer?.disconnect(); fonts?.removeEventListener?.("loadingdone", update); };
  }, [text, revision]);
  return <span ref={viewport} className="lxs-cell-text lxs-cell-text-shrink" aria-hidden={hidden || undefined}>
    <span ref={measurement} className="lxs-cell-text-measure" aria-hidden="true">{text}</span>
    <span className="lxs-cell-text-scaled" style={{ fontSize: `${scale * 100}%` }}>{text}</span>
  </span>;
}
