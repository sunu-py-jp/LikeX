import type { CSSProperties } from "react";
import type { SpreadsheetCellFormat } from "../../model/types";
import { estimateTextWidth } from "../../model/sizing/text-measurer";
import { cellTextIndentStyle } from "../grid/cell-style";
import { layoutAlignedCellText } from "../grid/aligned-cell-text";

type ThumbnailCellTextProps = { text: string; format?: SpreadsheetCellFormat; width: number; height: number; after: number };
const MAX_TEXT = 2_000;

/** Thumbnail text remains deterministic and DOM-free; font metrics are estimated. */
export function ThumbnailCellText({ text, format, width, height, after }: ThumbnailCellTextProps) {
  const style: CSSProperties = { ...(after > 0 ? { width: `calc(100% + ${after}px)` } : {}),
    ...cellTextIndentStyle(format) };
  const indent = ["left", "right", "distributed"].includes(format?.align ?? "general")
    ? (format?.indent ?? 0) * estimateTextWidth("0", format) * 3 * (format?.align === "distributed" ? 2 : 1) : 0;
  const available = Math.max(1, width + after - 5 - indent);
  const advancedHorizontal = format?.align === "fill" || format?.align === "justify" || format?.align === "distributed";
  if (text && (advancedHorizontal || format?.verticalAlign === "justify" || format?.verticalAlign === "distributed")) {
    const layout = layoutAlignedCellText(text, available, format?.align, !!format?.wrap, false, value => estimateTextWidth(value, format));
    if (layout.fallbackText !== undefined) {
      const wraps = format?.align !== "fill" && (format?.wrap || format?.align === "justify" || format?.align === "distributed");
      return <span className="lxs-cell-text lxs-thumbnail-text-fallback" style={{ ...style, flex: "1 1 auto", height: "100%",
        whiteSpace: wraps ? "pre-wrap" : "pre", overflowWrap: wraps ? "anywhere" : undefined,
        textAlignLast: format?.align === "distributed" ? "justify" : undefined }}>{layout.fallbackText.slice(0, MAX_TEXT)}</span>;
    }
    let remaining = MAX_TEXT;
    const lines: typeof layout.lines = [];
    for (const line of layout.lines) {
      if (remaining <= 0) break;
      const text = line.text.slice(0, remaining);
      remaining -= Math.max(1, text.length);
      lines.push({ ...line, text });
    }
    const clipped = layout.clipped || lines.length * (format?.fontSize ?? 13) * 1.2 > height;
    const justifyContent = clipped || format?.verticalAlign === "top" ? "flex-start"
      : format?.verticalAlign === "bottom" ? "flex-end" : format?.verticalAlign === "justify" ? "space-between"
        : format?.verticalAlign === "distributed" ? "space-around" : "center";
    return <span className="lxs-cell-text lxs-thumbnail-text-spread" style={{ ...style, justifyContent }}>
      {lines.map((line, index) => <span key={index} className="lxs-thumbnail-text-line" style={{ textAlign: line.textAlign ?? (advancedHorizontal ? "left" : undefined) }}>
        <span className="lxs-thumbnail-text-content" style={{ letterSpacing: line.letterSpacing, wordSpacing: line.wordSpacing,
          marginRight: line.letterSpacing ? -line.letterSpacing : undefined }}>{line.text || "\u00a0"}</span>
      </span>)}
    </span>;
  }
  return <span className="lxs-cell-text" style={Object.keys(style).length ? style : undefined}>{text}</span>;
}
