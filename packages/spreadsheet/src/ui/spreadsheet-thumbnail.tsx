"use client";
/* Validated embedded sources do not require an image-loader integration. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SpreadsheetWorkbookSnapshot } from "../commands/types";
import type { SpreadsheetColorMode } from "../props";
import { createPrimaryColorPalette } from "../core";
import { normalizeSpreadsheetThumbnail, prepareNormalizedSpreadsheetThumbnail } from "./thumbnail/prepare-thumbnail";
import { Shape } from "./drawings/shape";
import { DrawingText } from "./drawings/drawing-text";
import { LineMarker } from "./drawings/line-marker";

export type SpreadsheetThumbnailProps = {
  /** Replacing this immutable input updates the preview. Only the selected sheet's A1:J20 is displayed. */
  workbook: SpreadsheetWorkbookSnapshot;
  /** Exact sheet ID. Omitting both selectors shows the first sheet. */
  sheetId?: string;
  /** Exact, case-sensitive sheet name. Both selectors, when provided, must identify the same sheet. */
  sheetName?: string;
  title?: string;
  colorMode?: SpreadsheetColorMode;
  primaryColor?: string;
  className?: string;
  /** Default height is 280px. No minimum height is imposed. */
  style?: CSSProperties;
  "aria-label"?: string;
  /** Invalid data shows a placeholder; observer failures do not affect the view. */
  onError?: (error: Error) => void;
};

/** Compact static content, without an editor, selection, workbook history or full-workbook calculation. */
export function SpreadsheetThumbnail(props: SpreadsheetThumbnailProps) {
  const { onError } = props;
  const errorObserver = useRef(onError);
  useEffect(() => { errorObserver.current = onError; }, [onError]);
  const normalized = useMemo(() => {
    try { return { workbook: normalizeSpreadsheetThumbnail(props.workbook) }; }
    catch (cause) { return { error: cause instanceof Error ? cause : new Error("サムネイルを表示できません") }; }
  }, [props.workbook]);
  const prepared = useMemo(() => {
    if (normalized.error) return { error: normalized.error };
    try { return { scene: prepareNormalizedSpreadsheetThumbnail(normalized.workbook!, props.sheetId, props.sheetName) }; }
    catch (cause) { return { error: cause instanceof Error ? cause : new Error("サムネイルを表示できません") }; }
  }, [normalized, props.sheetId, props.sheetName]);
  useEffect(() => {
    if (prepared.error) try { void Promise.resolve(errorObserver.current?.(prepared.error)).catch(() => {}); }
    catch { /* Observer errors do not break the placeholder. */ }
  }, [prepared]);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (props.colorMode !== "system" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [props.colorMode]);
  const dark = props.colorMode === "dark" || (props.colorMode === "system" && systemDark);
  const palette = useMemo(() => createPrimaryColorPalette(props.primaryColor, dark ? "dark" : "light"), [props.primaryColor, dark]);
  const marker = useId().replace(/:/g, ""), scene = prepared.scene;
  const title = props.title?.trim() || "スプレッドシート";
  const style = { height: 280, minHeight: 0, ...(palette ? { "--lxs-primary": palette.primary, "--lxs-on-primary": palette.onPrimary,
    "--lxs-primary-hover": palette.primaryHover, "--lxs-accent": palette.accent } : {}), ...props.style } as CSSProperties;
  return <section data-likex-spreadsheet data-likex-spreadsheet-thumbnail data-color-mode={dark ? "dark" : "light"}
    className={`lxs-root lxs-thumbnail ${props.className ?? ""}`} style={style} role="img"
    aria-label={props["aria-label"] ?? `${title} — ${scene ? `${scene.sheetName}の先頭範囲` : "サムネイルを表示できません"}`}>
    <header className="lxs-title-bar"><span className="lxs-app-mark" aria-hidden="true">▦</span><span className="lxs-title">{title}</span><span className="lxs-title-context">LikeX</span></header>
    <div className="lxs-thumbnail-viewport" aria-hidden="true">
      {scene ? <svg className="lxs-thumbnail-fit" width="100%" height="100%" viewBox={`0 0 ${scene.width} ${scene.height}`}
        preserveAspectRatio="xMidYMid meet" style={{ maxWidth: scene.width, maxHeight: scene.height }}>
        <foreignObject width={scene.width} height={scene.height}>
          <div className="lxs-thumbnail-content" style={{ width: scene.width, height: scene.height }}>
            {scene.cells.map(cell => <div key={cell.address} data-lxs-thumbnail-cell={cell.address} className="lxs-cell lxs-thumbnail-cell" style={cell.style}>
              {cell.dataBar && <span className="lxs-cell-data-bar" style={{ left: `${cell.dataBar.start}%`, width: `${cell.dataBar.width}%`, backgroundColor: cell.dataBar.color }} />}
              <span className="lxs-cell-text">{cell.text}</span>
            </div>)}
            {scene.drawings.map((item, index) => {
              const drawing = item.drawing;
              if (item.kind === "line") {
                const line = item.drawing, start = line.startArrow ?? "none", end = line.endArrow ?? (line.shape === "arrow" ? "triangle" : "none");
                const id = `${marker}-${index}`;
                return <svg key={line.id} data-lxs-thumbnail-drawing={line.id} className="lxs-thumbnail-line" width={scene.width} height={scene.height}>
                  <defs><LineMarker id={`${id}-start`} kind={start} color={line.stroke} /><LineMarker id={`${id}-end`} kind={end} color={line.stroke} /></defs>
                  <polyline points={item.points} fill="none" stroke={line.stroke} strokeWidth={line.strokeWidth} strokeLinejoin="round" strokeLinecap="round"
                    markerStart={start !== "none" ? `url(#${id}-start)` : undefined} markerEnd={end !== "none" ? `url(#${id}-end)` : undefined} />
                  {!!line.text && <text x={item.label.x} y={item.label.y} textAnchor="middle" fill={line.color ?? "#1f2937"} fontSize={line.fontSize ?? 16} fontWeight={line.bold ? "bold" : undefined}>{line.text}</text>}
                </svg>;
              }
              return <div key={drawing.id} data-lxs-thumbnail-drawing={drawing.id} className="lxs-drawing lxs-thumbnail-drawing" style={{ left: item.left, top: item.top,
                width: drawing.width, height: drawing.height, transform: `rotate(${drawing.rotation ?? 0}deg)` }}>
                {drawing.type === "image" ? <img src={item.src} alt="" draggable={false} decoding="async" style={{ transform: `scale(${drawing.flipX ? -1 : 1},${drawing.flipY ? -1 : 1})` }} /> : <>
                  {drawing.type === "shape" && <Shape drawing={drawing} />}<DrawingText drawing={drawing} placeholder={false} />
                </>}
              </div>;
            })}
          </div>
        </foreignObject>
      </svg> : <span className="lxs-thumbnail-placeholder">サムネイルを表示できません</span>}
    </div>
  </section>;
}
