"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { SpreadsheetCellFormat } from "../../model/types";

type Alignment = SpreadsheetCellFormat["align"];
type VerticalAlignment = SpreadsheetCellFormat["verticalAlign"];
export type AlignedCellTextProps = {
  text: string; align: Alignment; verticalAlign: VerticalAlignment; wrap?: boolean; hidden: boolean;
  shrink?: boolean; style?: CSSProperties; revision: string; overflow?: boolean;
};
type TextLine = { text: string; paragraphEnd: boolean; letterSpacing?: number; wordSpacing?: number; textAlign?: CSSProperties["textAlign"] };
type TextLayout = { source: string; lines: TextLine[]; scale: number; lineHeight?: number; clipped?: boolean; fallbackText?: string };
const MAX_LAYOUT_CHARACTERS = 32_768, MAX_LAYOUT_LINES = 512, MAX_MEASUREMENTS = 4_096;
const fontContexts = new WeakMap<Document, CanvasRenderingContext2D>();
const graphemeSegmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function graphemes(text: string): string[] {
  // Keep combining marks and emoji together when inserting inter-character spacing.
  if (graphemeSegmenter) return Array.from(graphemeSegmenter.segment(text), item => item.segment);
  return Array.from(text);
}
function manualLines(text: string): TextLine[] {
  return text.split(/\r\n|\r|\n/, MAX_LAYOUT_LINES + 1).map(line => ({ text: line, paragraphEnd: true }));
}
function nativeLayout(text: string): TextLayout {
  // Preserve all text and let CSS clip/wrap it; only advanced spacing is approximated.
  return { source: text, lines: [], scale: 1, clipped: true, fallbackText: text };
}
function unmeasuredLayout(text: string): TextLayout {
  if (text.length > MAX_LAYOUT_CHARACTERS) return nativeLayout(text);
  const lines = manualLines(text);
  return lines.length > MAX_LAYOUT_LINES ? nativeLayout(text) : { source: text, lines, scale: 1 };
}
function horizontalPosition(align: Alignment): CSSProperties["textAlign"] {
  return align === "right" ? "right" : align === "center" || align === "centerContinuous" ? "center" : "left";
}
function breakOpportunity(character: string) {
  return /\s|[-/\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(character);
}

/** Bounded layout for advanced placements only; ordinary cell text never enters this path. */
export function layoutAlignedCellText(text: string, width: number, align: Alignment, wrap: boolean, shrink: boolean,
  measure?: (text: string) => number): TextLayout {
  const initial = unmeasuredLayout(text);
  if (initial.fallbackText !== undefined || !measure || !(width > 0)) return initial;
  const paragraphs = initial.lines;
  const lines: TextLine[] = [];
  let measurements = 0, exhausted = false, overflowed = false;
  const measured = (value: string) => {
    if (++measurements > MAX_MEASUREMENTS) { exhausted = true; return undefined; }
    const result = measure(value);
    return Number.isFinite(result) && result >= 0 ? result : undefined;
  };
  let scale = 1;
  if (shrink && !wrap && align !== "fill" && align !== "justify" && align !== "distributed") {
    let largest = 0;
    for (const line of paragraphs) largest = Math.max(largest, measured(line.text) ?? 0);
    if (largest > width) scale = width / largest;
  }
  const wrapping = align !== "fill" && (wrap || align === "justify" || align === "distributed");
  for (const paragraph of paragraphs) {
    if (lines.length >= MAX_LAYOUT_LINES || exhausted) { overflowed = true; break; }
    if (align === "fill") {
      const natural = measured(paragraph.text);
      const repeat = natural && paragraph.text ? Math.min(2_048, Math.floor(MAX_LAYOUT_CHARACTERS / paragraph.text.length), Math.max(1, Math.floor(width / natural))) : 1;
      lines.push({ text: paragraph.text.repeat(repeat), paragraphEnd: true });
      continue;
    }
    if (!wrapping || !paragraph.text) { lines.push(paragraph); continue; }
    const units = graphemes(paragraph.text);
    let start = 0;
    while (start < units.length && lines.length < MAX_LAYOUT_LINES && !exhausted) {
      // Exponential search followed by binary search avoids quadratic prefix measurement.
      let low = 0, high = 1;
      while (high <= units.length - start) {
        const candidate = measured(units.slice(start, start + high).join(""));
        if (candidate === undefined || candidate > width) break;
        low = high;
        if (high === units.length - start) break;
        high = Math.min(units.length - start, high * 2);
      }
      while (!exhausted && low + 1 < high) {
        const middle = Math.floor((low + high) / 2), candidate = measured(units.slice(start, start + middle).join(""));
        if (candidate !== undefined && candidate <= width) low = middle; else high = middle;
      }
      let count = Math.max(1, low);
      if (start + count < units.length) {
        // Prefer word/CJK boundaries, but split an overlong word rather than dropping it.
        for (let index = count - 1; index > 0; index--) if (breakOpportunity(units[start + index])) { count = index + 1; break; }
      }
      const end = start + count;
      let nextStart = end;
      while (nextStart < units.length && /^[ \t]$/.test(units[nextStart])) nextStart++;
      lines.push({ text: units.slice(start, end).join(""), paragraphEnd: nextStart === units.length });
      start = nextStart;
    }
    if (start < units.length) overflowed = true;
  }
  if (exhausted || overflowed) return nativeLayout(text);
  for (const line of lines) {
    if (align !== "distributed" && (align !== "justify" || line.paragraphEnd)) continue;
    // Whitespace at a wrap boundary does not consume the justification gap.
    line.text = line.text.trimEnd();
    const units = graphemes(line.text), natural = measured(line.text);
    if (natural === undefined || natural >= width) continue;
    if (units.length <= 1) { if (align === "distributed") line.textAlign = "center"; continue; }
    const spaces = (line.text.match(/ /g) ?? []).length;
    if (align === "justify" && spaces) line.wordSpacing = (width - natural) / spaces;
    else line.letterSpacing = (width - natural) / (units.length - 1);
  }
  return exhausted ? nativeLayout(text) : { source: text, lines, scale };
}

function fontMeasurement(box: HTMLSpanElement, computed: CSSStyleDeclaration): ((text: string) => number) | undefined {
  const document = box.ownerDocument;
  let context = fontContexts.get(document);
  if (!context) {
    try { context = document.createElement("canvas").getContext("2d") ?? undefined; } catch { return; }
    if (!context) return;
    fontContexts.set(document, context);
  }
  context.font = computed.font || `${computed.fontStyle || "normal"} ${computed.fontWeight || "normal"} ${computed.fontSize || "13px"} ${computed.fontFamily || "sans-serif"}`;
  const letterSpacing = parseFloat(computed.letterSpacing) || 0, wordSpacing = parseFloat(computed.wordSpacing) || 0;
  return text => context!.measureText(text).width + (letterSpacing ? Math.max(0, graphemes(text).length - 1) * letterSpacing : 0) + (wordSpacing ? (text.match(/ /g)?.length ?? 0) * wordSpacing : 0);
}
function equalLayout(left: TextLayout, right: TextLayout) {
  return left.source === right.source && left.scale === right.scale && left.lineHeight === right.lineHeight && left.clipped === right.clipped && left.fallbackText === right.fallbackText &&
    left.lines.length === right.lines.length && left.lines.every((line, index) => {
      const next = right.lines[index];
      return line.text === next.text && line.paragraphEnd === next.paragraphEnd && line.letterSpacing === next.letterSpacing &&
        line.wordSpacing === next.wordSpacing && line.textAlign === next.textAlign;
    });
}

export function AlignedCellText({ text, align, verticalAlign, wrap = false, hidden, shrink = false, style, revision, overflow = false }: AlignedCellTextProps) {
  const viewport = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<TextLayout>(() => unmeasuredLayout(text));
  const visible = layout.source === text ? layout : unmeasuredLayout(text);
  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box) return;
    let disposed = false, previousGeometry = "";
    const update = (force = false) => {
      if (disposed) return;
      const computed = box.ownerDocument.defaultView?.getComputedStyle?.(box);
      if (!computed) return;
      // Computed widths are unzoomed CSS pixels and retain subpixel narrow-column sizes.
      const horizontalPadding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
      const verticalPadding = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
      const measuredWidth = parseFloat(computed.width), measuredHeight = parseFloat(computed.height);
      const width = Number.isFinite(measuredWidth) ? measuredWidth - (computed.boxSizing === "border-box" ? horizontalPadding : 0) : box.clientWidth - horizontalPadding;
      const height = Number.isFinite(measuredHeight) ? measuredHeight - (computed.boxSizing === "border-box" ? verticalPadding : 0) : box.clientHeight - verticalPadding;
      if (!(width > 0)) return;
      const geometry = [width, height, computed.font, computed.fontFamily, computed.fontSize, computed.fontWeight, computed.fontStyle, computed.lineHeight, computed.letterSpacing, computed.wordSpacing].join("|");
      if (!force && previousGeometry === geometry) return;
      previousGeometry = geometry;
      const needsMeasurement = align === "fill" || align === "justify" || align === "distributed" || wrap || shrink;
      const next = layoutAlignedCellText(text, width, align, wrap, shrink, needsMeasurement ? fontMeasurement(box, computed) : undefined);
      const fontSize = parseFloat(computed.fontSize) || 13, lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
      next.lineHeight = lineHeight * next.scale;
      next.clipped ||= height > 0 && next.lines.length * next.lineHeight > height;
      setLayout(previous => equalLayout(previous, next) ? previous : next);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
    observer?.observe(box);
    const fonts = box.ownerDocument.fonts, fontChanged = () => update(true);
    fonts?.addEventListener?.("loadingdone", fontChanged);
    if (fonts?.status === "loading") void fonts.ready.then(fontChanged, () => {});
    return () => { disposed = true; observer?.disconnect(); fonts?.removeEventListener?.("loadingdone", fontChanged); };
  }, [text, align, verticalAlign, wrap, shrink, revision]);
  const placement = visible.clipped ? "flex-start" : verticalAlign === "justify" ? "space-between" : verticalAlign === "distributed" ? "space-around"
    : verticalAlign === "top" ? "flex-start" : verticalAlign === "bottom" ? "flex-end" : "center";
  return <span ref={viewport} className={`lxs-cell-text lxs-cell-text-aligned${overflow ? " lxs-cell-text-overflow" : ""}`} aria-hidden={hidden || undefined}
    style={{ ...style, justifyContent: placement }}>
    {visible.fallbackText !== undefined ? <span className="lxs-cell-text-native lxs-cell-text-content" style={{
      whiteSpace: align !== "fill" && (wrap || align === "justify" || align === "distributed") ? "pre-wrap" : "pre",
      overflowWrap: "anywhere", textAlign: align === "justify" || align === "distributed" ? "justify" : horizontalPosition(align),
      textAlignLast: align === "distributed" ? "justify" : undefined,
    }}>{visible.fallbackText}</span> : visible.lines.map((line, index) => <span key={index} className="lxs-cell-text-line" style={{ textAlign: line.textAlign ?? horizontalPosition(align),
      fontSize: visible.scale === 1 ? undefined : `${visible.scale * 100}%`, lineHeight: visible.lineHeight ? `${visible.lineHeight}px` : undefined }}>
      <span className="lxs-cell-text-content" style={{ letterSpacing: line.letterSpacing, wordSpacing: line.wordSpacing,
        marginRight: line.letterSpacing ? -line.letterSpacing : undefined }}>{line.text || "\u00a0"}</span>
    </span>)}
  </span>;
}
