"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetDrawing } from "../../model/types";
import { shapeTextFrame } from "../../model/shapes";
import { drawingTextStyle } from "./drawing-text-style";

/** Shared text layout for the editor and compact previews, including imported DrawingML boxes. */
export function DrawingText({ drawing, placeholder = true }: { drawing: Exclude<SpreadsheetDrawing, { type: "image" }>; placeholder?: boolean }) {
  const box = useRef<HTMLDivElement>(null), content = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState<number>();
  const style = drawingTextStyle(drawing), baseSize = drawing.fontSize ?? 16;
  useLayoutEffect(() => {
    const element = box.current, text = content.current;
    if (!element || !text || drawing.textAutoFit !== "shrink") { setScale(undefined); return; }
    let active = true;
    const fit = () => {
      if (!active) return;
      const view = element.ownerDocument.defaultView;
      if (!view) return;
      // CSS sizes retain fractions and exclude sheet zoom/rotation. Mixing integer
      // clientWidth with fractional DrawingML insets can make even empty text fail.
      const boxStyle = view.getComputedStyle(element), borderBox = boxStyle.boxSizing === "border-box";
      const width = Math.max(0, parseFloat(boxStyle.width) - (borderBox ? parseFloat(boxStyle.paddingLeft) + parseFloat(boxStyle.paddingRight) : 0));
      const height = Math.max(0, parseFloat(boxStyle.height) - (borderBox ? parseFloat(boxStyle.paddingTop) + parseFloat(boxStyle.paddingBottom) : 0));
      if (!width || !height) return;
      const previous = text.style.fontSize, previousWidth = text.style.width;
      // Fit-content measures the text itself, while still wrapping at the box
      // width. scrollWidth is rounded and can admit a partly clipped last glyph.
      text.style.width = "fit-content";
      const fits = (ratio: number) => {
        text.style.fontSize = `${baseSize * ratio}px`;
        const size = view.getComputedStyle(text);
        return parseFloat(size.width) <= width && parseFloat(size.height) <= height;
      };
      let low = 0.01, high = drawing.textFontScale ?? 1;
      if (!fits(high)) for (let i = 0; i < 12; i++) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; }
      else low = high;
      text.style.fontSize = previous;
      text.style.width = previousWidth;
      setScale(low);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(fit);
    observer?.observe(element);
    void element.ownerDocument.fonts?.ready.then(fit);
    return () => { active = false; observer?.disconnect(); };
  }, [drawing, baseSize]);
  const frame = drawing.type === "shape" ? shapeTextFrame(drawing) : undefined;
  const resizing = drawing.textAutoFit === "resize";
  return <div ref={box} className={drawing.type === "shape" ? "lxs-shape-text" : "lxs-text-box"}
    style={{ ...style, ...(frame ? { ...frame, right: "auto", bottom: "auto" } : {}),
      ...(resizing ? { minHeight: frame?.height ?? "100%", height: "auto" } : {}) }}>
    <span ref={content} style={{ ...(scale === undefined ? {} : { fontSize: baseSize * scale }) }}>{drawing.text || (placeholder && drawing.type === "text" ? "テキストを入力" : "")}</span>
  </div>;
}
