import type { DocumentTableMargins, DocumentTableWidth } from "../model/types";
import { attr, child, children, on, type XmlNode } from "./docx-reader";

type Warning = (message: string) => void;
type TableProperties = { width?: DocumentTableWidth | null; layout?: "auto" | "fixed"; cellMargins?: DocumentTableMargins };
type CellProperties = { preferredWidth?: DocumentTableWidth | null; margins?: DocumentTableMargins; noWrap?: boolean; fitText?: boolean };

export function readDocxTableWidth(node: XmlNode | undefined, warn: Warning): DocumentTableWidth | null | undefined {
  if (!node) return undefined;
  const type = attr(node, "type") ?? "dxa", raw = attr(node, "w") ?? "0";
  if (["auto", "nil"].includes(type)) return null;
  const value = type === "pct" ? raw.endsWith("%") ? Number(raw.slice(0, -1)) : Number(raw) / 50 : Number(raw) / 15;
  if (!["dxa", "pct"].includes(type) || !Number.isFinite(value) || value <= 0 || value > (type === "pct" ? 500 : 5000)) {
    warn("表・セルの未対応または不正な幅指定を省略しました"); return undefined;
  }
  return { unit: type === "pct" ? "percent" : "px", value };
}
function readMargins(node: XmlNode | undefined, warn: Warning): DocumentTableMargins | undefined {
  if (!node) return undefined;
  const margins: DocumentTableMargins = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const edge = child(node, side === "left" ? "start" : side === "right" ? "end" : side) ?? child(node, side);
    if (!edge) continue;
    const type = attr(edge, "type") ?? "dxa", value = type === "nil" ? 0 : Number(attr(edge, "w")) / 15;
    if (!["dxa", "nil"].includes(type) || !Number.isFinite(value) || value < 0 || value > 5000) { warn("表・セルの未対応または不正な余白指定を省略しました"); continue; }
    margins[side] = value;
  }
  return margins;
}
function tableProperties(node: XmlNode | undefined, warn: Warning): TableProperties {
  const result: TableProperties = {}, width = readDocxTableWidth(child(node, "tblW"), warn), layout = attr(child(node, "tblLayout"), "type");
  if (width !== undefined) result.width = width;
  if (layout === "fixed" || layout === "autofit") result.layout = layout === "fixed" ? "fixed" : "auto";
  else if (layout) warn("未対応の表レイアウトを自動調整に変換しました");
  const margins = readMargins(child(node, "tblCellMar"), warn); if (margins) result.cellMargins = margins;
  if (on(child(node, "bidiVisual"))) warn("右から左に配置する表は左から右の列順で読み込みました");
  if (child(node, "tblpPr") || Number(attr(child(node, "tblInd"), "w") ?? 0) !== 0) warn("表の浮動配置・インデントは本文内の左揃えで表示します");
  return result;
}
function cellProperties(node: XmlNode | undefined, warn: Warning): CellProperties {
  const result: CellProperties = {}, width = readDocxTableWidth(child(node, "tcW"), warn), margins = readMargins(child(node, "tcMar"), warn);
  if (width !== undefined) result.preferredWidth = width;
  if (margins) result.margins = margins;
  for (const [tag, key] of [["noWrap", "noWrap"], ["tcFitText", "fitText"]] as const) {
    const value = on(child(node, tag)); if (value !== undefined) result[key] = value;
  }
  return result;
}
const mergeTable = (base: TableProperties, next: TableProperties): TableProperties => ({ ...base, ...next, cellMargins: { ...base.cellMargins, ...next.cellMargins } });
const mergeCell = (base: CellProperties, next: CellProperties): CellProperties => ({ ...base, ...next, margins: { ...base.margins, ...next.margins } });

/** Resolve direct and basedOn table styles without changing paragraph/numbering style resolution. */
export function createDocxTableReader(stylesRoot: XmlNode | undefined, warn: Warning) {
  const styles = new Map(children(stylesRoot, "style").filter(node => attr(node, "type") === "table").map(node => [attr(node, "styleId"), node]));
  const defaultStyle = [...styles.values()].find(node => ["true", "1", "on"].includes(attr(node, "default") ?? ""));
  function resolve(id: string | undefined, seen = new Set<string>()): { table: TableProperties; cell: CellProperties } {
    if (!id) return { table: {}, cell: {} };
    if (seen.has(id) || seen.size >= 32) { warn("循環または深すぎる表スタイル継承を省略しました"); return { table: {}, cell: {} }; }
    const style = styles.get(id);
    if (!style) { warn("参照先が見つからない表スタイルを省略しました"); return { table: {}, cell: {} }; }
    const base = resolve(attr(child(style, "basedOn"), "val"), new Set([...seen, id]));
    if (children(style, "tblStylePr").length) warn("表スタイルの条件付き書式は通常の表書式に統一しました");
    return { table: mergeTable(base.table, tableProperties(child(style, "tblPr"), warn)), cell: mergeCell(base.cell, cellProperties(child(style, "tcPr"), warn)) };
  }
  return (properties: XmlNode | undefined) => {
    const style = resolve(attr(child(properties, "tblStyle"), "val") ?? attr(defaultStyle, "styleId"));
    const table = mergeTable(style.table, tableProperties(properties, warn));
    // ISO 29500 defaults: no vertical margin; 115 twips at the leading/trailing edges.
    const attrs = { width: table.width ?? null, layout: table.layout ?? "auto", cellMargins: { top: 0, right: 115 / 15, bottom: 0, left: 115 / 15, ...table.cellMargins } };
    return { attrs, cell(cell: XmlNode | undefined, row: XmlNode | undefined): CellProperties {
      const rowProperties = tableProperties(row, warn);
      if (rowProperties.layout || rowProperties.width !== undefined) warn("行ごとに異なる表幅・レイアウトは表全体の指定に統一しました");
      const result = mergeCell(mergeCell(style.cell, { margins: rowProperties.cellMargins }), cellProperties(cell, warn));
      if (result.fitText) warn("セルの文字列を幅に合わせる設定は保持しますが、文字間隔の自動伸縮は表示に反映しません");
      return result;
    } };
  };
}
export function writeDocxTableWidth(tag: "tblW" | "tcW", width: DocumentTableWidth | null | undefined): string {
  return width ? `<w:${tag} w:w="${Math.max(1, Math.round(width.value * (width.unit === "px" ? 15 : 50)))}" w:type="${width.unit === "px" ? "dxa" : "pct"}"/>` : `<w:${tag} w:w="0" w:type="auto"/>`;
}
export function writeDocxTableMargins(tag: "tblCellMar" | "tcMar", margins: DocumentTableMargins | null | undefined): string {
  if (!margins || !Object.keys(margins).length) return "";
  return `<w:${tag}>${(["top", "left", "bottom", "right"] as const).map(side => margins[side] == null ? "" : `<w:${side} w:w="${Math.round(margins[side] * 15)}" w:type="dxa"/>`).join("")}</w:${tag}>`;
}
